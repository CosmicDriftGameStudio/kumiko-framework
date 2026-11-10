// Editor-only rendering of the print model: free values (font, size, spacing, cell colours, table
// borders) are drawn as ProseMirror decorations, so they never reach getHTML. The same
// document-style-css builders as the PDF compile keep the editor and the print in step.

import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { DocumentFont } from "./document-fonts.ts";
import { DOCUMENT_FONTS } from "./document-fonts.ts";
import type { DocumentFrameControl, FrameLocation } from "./document-frame-control.ts";
import {
  buildFrameControl,
  FRAME_NODE_NAME,
  FRAME_SELECTED_ATTRIBUTE,
  frameFlowBottomMm,
  frameLocationOf,
  isSenderLine,
} from "./document-frame-control.ts";
import { type RepeatStripOptions, repeatStripDecorations } from "./document-repeat-strip.ts";
import {
  addressParagraphCss,
  DOCUMENT_LINE_VARIABLE,
  documentBlockStyleCss,
  documentCellStyleCss,
  documentTextStyleCss,
  PARAGRAPH_DEFAULT_LINE_HEIGHT,
} from "./document-style-css.ts";

// Metric-compatible web fonts (@fontsource) stand in for the print service's installed fonts.
const EDITOR_FONT_STACKS: Readonly<Record<DocumentFont, string>> = {
  arial: 'Arimo,"Liberation Sans",Arial,sans-serif',
  times: 'Tinos,"Liberation Serif","Times New Roman",serif',
  courier: 'Cousine,"Liberation Mono","Courier New",monospace',
  calibri: "Carlito,Calibri,sans-serif",
  cambria: "Caladea,Cambria,serif",
};

// Fonts are cosmetic: the stacks fall back to system fonts when the chunk fails to load.
export function loadDocumentEditorFonts(): Promise<unknown> {
  return import("./document-editor-fonts.ts").catch(() => undefined);
}

const TEXT_STYLE_MARK = "documentTextStyle";
const BLOCK_STYLE_NODES: readonly string[] = ["paragraph", "heading"];
const CELL_NODES: readonly string[] = ["tableCell", "tableHeader"];

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function textStyleDecoration(node: ProseMirrorNode, from: number): Decoration | null {
  const mark = node.marks.find((candidate) => candidate.type.name === TEXT_STYLE_MARK);
  if (mark === undefined) return null;
  const font = mark.attrs["font"];
  const declarations = [
    documentTextStyleCss({
      color: stringOrNull(mark.attrs["color"]),
      sizePt: numberOrNull(mark.attrs["sizePt"]),
    }),
    isOneOf(DOCUMENT_FONTS, font) ? `font-family:${EDITOR_FONT_STACKS[font]}` : "",
  ].filter((part) => part !== "");
  return declarations.length === 0
    ? null
    : Decoration.inline(from, from + node.nodeSize, { style: declarations.join(";") });
}

function isAddressFrame(node: ProseMirrorNode | null): boolean {
  return node?.type.name === FRAME_NODE_NAME && node.attrs["preset"] === "address";
}

function nodeDecoration(
  node: ProseMirrorNode,
  from: number,
  parent: ProseMirrorNode | null,
  index: number,
): Decoration | null {
  const name = node.type.name;
  const to = from + node.nodeSize;
  if (BLOCK_STYLE_NODES.includes(name)) {
    const style = [
      documentBlockStyleCss({
        lineHeight: numberOrNull(node.attrs["lineHeight"]),
        spaceBeforePt: numberOrNull(node.attrs["spaceBeforePt"]),
        spaceAfterPt: numberOrNull(node.attrs["spaceAfterPt"]),
      }),
      name === "paragraph" && isAddressFrame(parent)
        ? addressParagraphCss(index === 0 && isSenderLine(node))
        : "",
    ]
      .filter((part) => part !== "")
      .join(";");
    return style === "" ? null : Decoration.node(from, to, { style });
  }
  if (CELL_NODES.includes(name)) {
    const style = documentCellStyleCss({ background: stringOrNull(node.attrs["background"]) });
    return style === "" ? null : Decoration.node(from, to, { style });
  }
  if (name === "table" && node.attrs["borders"] === "none") {
    return Decoration.node(from, to, { "data-borders": "none" });
  }
  return null;
}

// Frames are not rebuilt by the selection alone, so the selected one is marked by a decoration the
// node view styles; the same location drives the side panel.
function buildDecorations(
  doc: ProseMirrorNode,
  selection: Selection,
  extra: readonly Decoration[],
): DecorationSet {
  const decorations: Decoration[] = [];
  const selectedFrame = frameLocationOf(selection);
  doc.descendants((node, pos, parent, index) => {
    if (node.type.name === FRAME_NODE_NAME && selectedFrame?.pos === pos) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, { [FRAME_SELECTED_ATTRIBUTE]: "" }),
      );
    }
    const decoration = node.isInline
      ? textStyleDecoration(node, pos)
      : nodeDecoration(node, pos, parent, index);
    if (decoration !== null) decorations.push(decoration);
  });
  return DecorationSet.create(doc, [...decorations, ...extra]);
}

const FLOW_PADDING_CSS =
  "padding-top:max(0px,calc((var(--frame-flow-bottom) - var(--page-margin-top-mm,0)) * var(--paper-mm,1mm)))";
// The paper's own text size and the shared paragraph defaults, so editor lines measure like the PDF's.
const PAGE_TEXT_CSS = `font-size:var(--paper-font-size,inherit);line-height:${PARAGRAPH_DEFAULT_LINE_HEIGHT};${DOCUMENT_LINE_VARIABLE}:calc(var(--paper-font-size) * ${PARAGRAPH_DEFAULT_LINE_HEIGHT})`;

export type DocumentPrintEditingOptions = {
  /** Frames exist (PDF body): reserve the flow area below frames that push the text down. */
  readonly frames: boolean;
  readonly reportFrameControl: ((control: DocumentFrameControl | null) => void) | null;
  /** Shows the table strip that switches the repeated header row; null renders none. */
  readonly repeatStrip: RepeatStripOptions | null;
};

const DECORATION_KEY = new PluginKey<DecorationSet>("documentPrintDecorations");

export const DocumentPrintEditing = Extension.create<DocumentPrintEditingOptions>({
  name: "documentPrintEditing",
  addOptions() {
    return { frames: false, reportFrameControl: null, repeatStrip: null };
  },
  addProseMirrorPlugins() {
    const { frames, reportFrameControl, repeatStrip } = this.options;
    const { editor } = this;
    const stripOf = (doc: ProseMirrorNode): readonly Decoration[] =>
      repeatStrip === null || !editor.options.editable
        ? []
        : repeatStripDecorations(doc, editor, repeatStrip);
    const decorations = new Plugin<DecorationSet>({
      key: DECORATION_KEY,
      state: {
        init: (_config, state) => buildDecorations(state.doc, state.selection, stripOf(state.doc)),
        apply: (tr, previous) =>
          tr.docChanged || tr.selectionSet
            ? buildDecorations(tr.doc, tr.selection, stripOf(tr.doc))
            : previous,
      },
      props: {
        decorations: (state) => DECORATION_KEY.getState(state),
        attributes: (state): Record<string, string> =>
          frames
            ? {
                style: `--frame-flow-bottom:${frameFlowBottomMm(state.doc)};${FLOW_PADDING_CSS};${PAGE_TEXT_CSS}`,
              }
            : {},
      },
    });
    if (!frames || reportFrameControl === null) return [decorations];
    const reporter = new Plugin({
      view: () => {
        let last: FrameLocation | null = null;
        return {
          update: (view) => {
            const location = view.editable ? frameLocationOf(view.state.selection) : null;
            if (location?.pos === last?.pos && location?.node === last?.node) return;
            last = location;
            reportFrameControl(location === null ? null : buildFrameControl(editor, location));
          },
          destroy: () => reportFrameControl(null),
        };
      },
    });
    return [decorations, reporter];
  },
});
