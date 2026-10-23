import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { Editor, JSONContent } from "@tiptap/core";
import type { DocumentResourcePreview, DocumentToolbarBlock } from "./document-toolbar-blocks.ts";

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

export type RepeatTableState = {
  readonly lists: readonly string[];
  readonly headerRepeats: boolean;
  readonly firstRowPos: number;
};

// print-document moves the leading rows flagged repeatHeader into thead, so the
// toggle reads and writes the table's first row.
export function findRepeatTable(editor: Editor): RepeatTableState | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== "table") continue;
    const lists: string[] = [];
    node.forEach((row) => {
      const each: unknown = row.attrs["each"];
      if (typeof each === "string" && each !== "" && !lists.includes(each)) lists.push(each);
    });
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
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const row = tr.doc.nodeAt(found.firstRowPos);
      if (row === null) return false;
      tr.setNodeMarkup(found.firstRowPos, undefined, {
        ...row.attrs,
        repeatHeader: !found.headerRepeats,
      });
      return true;
    })
    .run();
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

function selectedBlockOf(
  e: Editor,
): { readonly type: "resource" | "button"; readonly detail: string } | null {
  if (e.isActive("resource")) {
    return { type: "resource", detail: String(e.getAttributes("resource")["resource"]) };
  }
  if (e.isActive("button")) {
    return { type: "button", detail: String(e.getAttributes("button")["href"]) };
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
  };
}

export type ActiveState = ReturnType<typeof activeStateOf>;
