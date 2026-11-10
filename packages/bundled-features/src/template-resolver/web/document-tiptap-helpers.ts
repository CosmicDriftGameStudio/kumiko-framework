import type { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  addressFrameContent,
  columnsTableContent,
  insertFrame,
  textFrameContent,
} from "./document-frame-control.ts";
import type {
  DocumentPrintBlock,
  DocumentPrintMode,
  DocumentResourcePreview,
  DocumentToolbarBlock,
} from "./document-toolbar-blocks.ts";

export const NO_LABELS: Readonly<Record<string, string>> = {};
export const NO_NAMES: readonly string[] = [];
export const NO_PREVIEWS: Readonly<Record<string, DocumentResourcePreview>> = {};

export function previewsKey(previews: Readonly<Record<string, DocumentResourcePreview>>): string {
  return Object.entries(previews)
    .map(([key, { src, caption }]) => `${key}|${src.length}|${src.slice(-24)}|${caption ?? ""}`)
    .join("\n");
}

export type PanelKind =
  | "link"
  | "placeholder"
  | "image"
  | "button"
  | "repeat"
  | "align"
  | "steps"
  | "images";

// Blocks that stay in the canvas toolbar; the rest moves into the overflow menu.
export const CANVAS_INLINE_BLOCKS: readonly DocumentToolbarBlock[] = ["image", "table"];

export const BLOCK_PANEL: Partial<Record<DocumentToolbarBlock, PanelKind>> = {
  image: "image",
  button: "button",
  repeat: "repeat",
  align: "align",
  steps: "steps",
  images: "images",
};

// PDF kinds are the ones whose block set carries a page break; a hosted toolbar means a layout region.
export function printModeOf(
  blocks: readonly DocumentToolbarBlock[],
  hosted: boolean,
  canvas: boolean,
): DocumentPrintMode {
  if (!blocks.includes("pageBreak")) return "none";
  return canvas && !hosted ? "page" : "flow";
}

export const FONT_SIZES_PT = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 24, 36] as const;
export const LINE_HEIGHTS = [1, 1.15, 1.2, 1.25, 1.5, 2] as const;
export const PARAGRAPH_SPACES_PT = [0, 3, 6, 8, 12, 18, 24] as const;

export type PrintTextStyleState = {
  readonly font: string | null;
  readonly sizePt: number | null;
  readonly color: string | null;
};

export type PrintBlockStyleState = {
  readonly lineHeight: number | null;
  readonly spaceBeforePt: number | null;
  readonly spaceAfterPt: number | null;
};

export type PrintTableState = {
  readonly bordersOff: boolean;
  readonly cellBackground: string | null;
};

const TEXT_STYLE_MARK = "documentTextStyle";

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function printTextStyleOf(e: Editor): PrintTextStyleState {
  const attrs = e.getAttributes(TEXT_STYLE_MARK);
  return {
    font: stringOrNull(attrs["font"]),
    sizePt: numberOrNull(attrs["sizePt"]),
    color: stringOrNull(attrs["color"]),
  };
}

function printBlockStyleOf(e: Editor): PrintBlockStyleState {
  const attrs = e.getAttributes(e.isActive("heading") ? "heading" : "paragraph");
  return {
    lineHeight: numberOrNull(attrs["lineHeight"]),
    spaceBeforePt: numberOrNull(attrs["spaceBeforePt"]),
    spaceAfterPt: numberOrNull(attrs["spaceAfterPt"]),
  };
}

type TableLocation = { readonly pos: number; readonly attrs: Record<string, unknown> };

function tableLocationOf(e: Editor): TableLocation | null {
  const { $from } = e.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table") return { pos: $from.before(depth), attrs: node.attrs };
  }
  return null;
}

function printTableOf(e: Editor): PrintTableState | null {
  const table = tableLocationOf(e);
  if (table === null) return null;
  const { $from } = e.state.selection;
  let cellBackground: string | null = null;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      cellBackground = stringOrNull(node.attrs["background"]);
      break;
    }
  }
  return { bordersOff: table.attrs["borders"] === "none", cellBackground };
}

type TextStylePatch = { readonly [K in keyof PrintTextStyleState]?: PrintTextStyleState[K] };

export function setPrintTextStyle(editor: Editor, patch: TextStylePatch): void {
  const next = { ...printTextStyleOf(editor), ...patch };
  const chain = editor.chain().focus();
  if (next.font === null && next.sizePt === null && next.color === null) {
    chain.unsetMark(TEXT_STYLE_MARK).run();
  } else {
    chain.setMark(TEXT_STYLE_MARK, next).run();
  }
}

export function setPrintBlockStyle(editor: Editor, patch: Partial<PrintBlockStyleState>): void {
  editor
    .chain()
    .focus()
    .updateAttributes("paragraph", patch)
    .updateAttributes("heading", patch)
    .run();
}

export function toggleTableBorders(editor: Editor): void {
  const table = tableLocationOf(editor);
  if (table === null) return;
  const borders = table.attrs["borders"] === "none" ? null : "none";
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setNodeMarkup(table.pos, undefined, { ...table.attrs, borders });
      return true;
    })
    .run();
}

export function insertPrintBlock(editor: Editor, block: DocumentPrintBlock): void {
  if (block === "address") insertFrame(editor, addressFrameContent());
  else if (block === "textFrame") insertFrame(editor, textFrameContent());
  else editor.chain().focus().insertContent(columnsTableContent()).run();
}

export type RepeatTableState = {
  readonly lists: readonly string[];
  readonly headerRepeats: boolean;
  readonly firstRowPos: number;
};

export function repeatListsOf(table: ProseMirrorNode): string[] {
  const lists: string[] = [];
  table.forEach((row) => {
    const each: unknown = row.attrs["each"];
    if (typeof each === "string" && each !== "" && !lists.includes(each)) lists.push(each);
  });
  return lists;
}

export function toggleRepeatHeaderAt(editor: Editor, firstRowPos: number): void {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const row = tr.doc.nodeAt(firstRowPos);
      if (row === null) return false;
      tr.setNodeMarkup(firstRowPos, undefined, {
        ...row.attrs,
        repeatHeader: row.attrs["repeatHeader"] !== true,
      });
      return true;
    })
    .run();
}

// print-document moves the leading rows flagged repeatHeader into thead, so the
// toggle reads and writes the table's first row.
export function findRepeatTable(editor: Editor): RepeatTableState | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== "table") continue;
    const lists = repeatListsOf(node);
    if (lists.length === 0) return null;
    return {
      lists,
      headerRepeats: node.firstChild?.attrs["repeatHeader"] === true,
      firstRowPos: $from.start(depth),
    };
  }
  return null;
}

export function toggleRepeatHeader(editor: Editor): void {
  const found = findRepeatTable(editor);
  // skip: the cursor is not inside a repeat table
  if (found === null) return;
  toggleRepeatHeaderAt(editor, found.firstRowPos);
}

const PARAGRAPH_STYLES = ["paragraph", "1", "2", "3"] as const;
type ParagraphStyle = (typeof PARAGRAPH_STYLES)[number];

export const HEADING_LEVELS = { "1": 1, "2": 2, "3": 3 } as const;

const PLACEHOLDER_HREF = /^\{\{([^{}]+)\}\}$/;

export function variableLabelOf(name: string, labels: Readonly<Record<string, string>>): string {
  return Object.hasOwn(labels, name) ? (labels[name] ?? name) : name;
}

export function buttonTargetLabel(href: string, labels: Readonly<Record<string, string>>): string {
  const name = PLACEHOLDER_HREF.exec(href)?.[1];
  return name === undefined ? href : variableLabelOf(name, labels);
}

export function isParagraphStyle(value: string): value is ParagraphStyle {
  return isOneOf(PARAGRAPH_STYLES, value);
}

function emptyParagraph(): JSONContent {
  return { type: "paragraph" };
}

export function repeatTableContent(listName: string): JSONContent {
  const headerRow: JSONContent = {
    type: "tableRow",
    content: [
      { type: "tableHeader", content: [emptyParagraph()] },
      { type: "tableHeader", content: [emptyParagraph()] },
    ],
  };
  const repeatRow: JSONContent = {
    type: "tableRow",
    attrs: { each: listName },
    content: [
      { type: "tableCell", content: [emptyParagraph()] },
      { type: "tableCell", content: [emptyParagraph()] },
    ],
  };
  return { type: "table", content: [headerRow, repeatRow] };
}

function blockStyleOf(e: Editor): "1" | "2" | "3" | "paragraph" {
  if (e.isActive("heading", { level: 1 })) return "1";
  if (e.isActive("heading", { level: 2 })) return "2";
  if (e.isActive("heading", { level: 3 })) return "3";
  return "paragraph";
}

function selectedBlockOf(e: Editor): SelectedBlock | null {
  if (e.isActive("resource")) {
    const attrs = e.getAttributes("resource");
    return { type: "resource", detail: String(attrs["resource"]), bleed: attrs["bleed"] === true };
  }
  if (e.isActive("button")) {
    return { type: "button", detail: String(e.getAttributes("button")["href"]), bleed: false };
  }
  return null; // skip: no resource or button selected
}

export function activeStateOf(e: Editor, showHtml: boolean) {
  return {
    blockStyle: blockStyleOf(e),
    bold: e.isActive("bold"),
    italic: e.isActive("italic"),
    underline: e.isActive("underline"),
    selectedBlock: selectedBlockOf(e),
    html: showHtml ? e.getHTML() : "",
    bulletList: e.isActive("bulletList"),
    orderedList: e.isActive("orderedList"),
    link: e.isActive("link"),
    repeatTable: findRepeatTable(e),
    textStyle: printTextStyleOf(e),
    paragraphStyle: printBlockStyleOf(e),
    printTable: printTableOf(e),
  };
}

export type Primitives = ReturnType<typeof usePrimitives>;

export type SelectedBlock = {
  readonly type: "resource" | "button";
  readonly detail: string;
  readonly bleed: boolean;
};

export type ActiveState = ReturnType<typeof activeStateOf>;
