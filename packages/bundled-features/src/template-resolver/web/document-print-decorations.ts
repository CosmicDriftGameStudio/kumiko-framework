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
import { DOCUMENT_TABLE_ALIGNMENTS, readRowLineAttributes } from "./document-print-style.ts";
import { type RepeatStripOptions, repeatStripDecorations } from "./document-repeat-strip.ts";
import {
  addressParagraphCss,
  DOCUMENT_LINE_VARIABLE,
  documentBlockStyleCss,
  documentCellStyleCss,
  documentDividerCss,
  documentTableCss,
  documentTextStyleCss,
  PARAGRAPH_DEFAULT_LINE_HEIGHT,
  resolveRowEdges,
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
  if (name === "divider") {
    const style = documentDividerCss({
      color: stringOrNull(node.attrs["color"]),
      weightPt: numberOrNull(node.attrs["weightPt"]),
    });
    return style === "" ? null : Decoration.node(from, to, { style });
  }
  return null;
}

// Cell padding, outer-column insets and row rules depend on the table and row around a cell, so
// the table decorates its own cells; the rules mirror the PDF compile's edge resolution.
function tableDecorations(table: ProseMirrorNode, from: number): Decoration[] {
  const align = table.attrs["align"];
  const tableStyle = documentTableCss({
    widthMm: numberOrNull(table.attrs["widthMm"]),
    align: isOneOf(DOCUMENT_TABLE_ALIGNMENTS, align) ? align : null,
  });
  const decorations: Decoration[] = [];
  const tableAttrs: Record<string, string> = {
    ...(table.attrs["borders"] === "none" ? { "data-borders": "none" } : {}),
    ...(tableStyle === "" ? {} : { style: tableStyle }),
  };
  if (Object.keys(tableAttrs).length > 0) {
    decorations.push(Decoration.node(from, from + table.nodeSize, tableAttrs));
  }
  const paddingMm = numberOrNull(table.attrs["cellPaddingMm"]);
  const rows: { node: ProseMirrorNode; pos: number }[] = [];
  table.forEach((row, offset) => {
    rows.push({ node: row, pos: from + 1 + offset });
  });
  const edges = resolveRowEdges(
    rows.map((row) => ({
      ...readRowLineAttributes(row.node.attrs),
      repeats: typeof row.node.attrs["each"] === "string",
    })),
  );
  rows.forEach((row, rowIndex) => {
    row.node.forEach((cell, offset, cellIndex) => {
      if (!CELL_NODES.includes(cell.type.name)) return;
      const style = documentCellStyleCss({
        background: stringOrNull(cell.attrs["background"]),
        paddingMm,
        isFirstInRow: cellIndex === 0,
        isLastInRow: cellIndex === row.node.childCount - 1,
        edges: edges[rowIndex],
      });
      if (style === "") return;
      const cellFrom = row.pos + 1 + offset;
      decorations.push(Decoration.node(cellFrom, cellFrom + cell.nodeSize, { style }));
    });
  });
  return decorations;
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
    if (node.type.name === "table") decorations.push(...tableDecorations(node, pos));
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
