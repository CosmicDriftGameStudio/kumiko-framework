import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration } from "@tiptap/pm/view";

export type RepeatStripOptions = {
  readonly label: (listNames: readonly string[]) => string;
  readonly headerLabel: string;
};

// Table start + first row + first cell: the widget sits in front of the first cell's content.
const FIRST_CELL_CONTENT_OFFSET = 3;
const FIRST_ROW_OFFSET_FROM_WIDGET = FIRST_CELL_CONTENT_OFFSET - 1;

// Sits in the line of space the table gets above it (one document line), never taller than that.
const STRIP_CLASS =
  "absolute bottom-full left-0 z-20 box-border flex h-[calc(var(--doc-line,1.25rem)-1px)] select-none items-center gap-2.5 whitespace-nowrap rounded-full border border-input bg-card pr-0.5 pl-2 text-[calc(var(--doc-line,1.25rem)*0.5)] font-normal uppercase leading-none tracking-wide text-muted-foreground";
const BUTTON_CLASS =
  "cursor-pointer rounded-full border px-1.5 py-px text-[1em] font-medium leading-none normal-case tracking-normal";
const BUTTON_OFF_CLASS = `${BUTTON_CLASS} border-input bg-card text-foreground`;
const BUTTON_ON_CLASS = `${BUTTON_CLASS} border-foreground bg-card text-foreground`;

function repeatListsOf(table: ProseMirrorNode): string[] {
  const lists: string[] = [];
  table.forEach((row) => {
    const each: unknown = row.attrs["each"];
    if (typeof each === "string" && each !== "" && !lists.includes(each)) lists.push(each);
  });
  return lists;
}

function toggleHeaderAt(editor: Editor, rowPos: number): void {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const row = tr.doc.nodeAt(rowPos);
      if (row === null) return false;
      tr.setNodeMarkup(rowPos, undefined, {
        ...row.attrs,
        repeatHeader: row.attrs["repeatHeader"] !== true,
      });
      return true;
    })
    .run();
}

function createStrip(
  editor: Editor,
  label: string,
  headerLabel: string,
  headerRepeats: boolean,
  getPos: () => number | undefined,
): HTMLElement {
  const strip = document.createElement("div");
  strip.className = STRIP_CLASS;
  strip.contentEditable = "false";
  strip.setAttribute("data-testid", "document-repeat-strip");
  const name = document.createElement("span");
  name.textContent = label;
  const button = document.createElement("button");
  button.type = "button";
  button.className = headerRepeats ? BUTTON_ON_CLASS : BUTTON_OFF_CLASS;
  button.setAttribute("aria-pressed", String(headerRepeats));
  button.setAttribute("data-testid", "document-repeat-header-toggle");
  button.textContent = headerLabel;
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    const pos = getPos();
    if (pos !== undefined) toggleHeaderAt(editor, pos - FIRST_ROW_OFFSET_FROM_WIDGET);
  });
  strip.append(name, button);
  return strip;
}

// Editor-only: a widget never reaches getHTML or the PDF, and it is absolutely placed on the
// table's top edge so it takes no height.
export function repeatStripDecorations(
  doc: ProseMirrorNode,
  editor: Editor,
  options: RepeatStripOptions,
): Decoration[] {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return;
    const lists = repeatListsOf(node);
    const firstCellContent = node.firstChild?.firstChild;
    if (lists.length === 0 || firstCellContent === null || firstCellContent === undefined) return;
    const headerRepeats = node.firstChild?.attrs["repeatHeader"] === true;
    const label = options.label(lists);
    decorations.push(
      Decoration.widget(
        pos + FIRST_CELL_CONTENT_OFFSET,
        (_view, getPos) => createStrip(editor, label, options.headerLabel, headerRepeats, getPos),
        {
          side: -1,
          key: `repeat-strip:${label}:${headerRepeats}`,
          ignoreSelection: true,
          stopEvent: () => true,
        },
      ),
    );
  });
  return decorations;
}
