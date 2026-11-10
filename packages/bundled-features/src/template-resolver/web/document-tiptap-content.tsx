import { cn } from "@cosmicdrift/kumiko-renderer/web";
import type { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import type { ReactNode } from "react";
import type { DocumentPrintMode } from "./document-toolbar-blocks.ts";

// The PDF pads cells 4px / 6px; in paper units so the canvas lines up at every zoom.
const CANVAS_CELL_PADDING_CLASS =
  "[&_td]:px-[calc(1.5875*var(--paper-mm,1mm))] [&_td]:py-[calc(1.0583*var(--paper-mm,1mm))] [&_th]:px-[calc(1.5875*var(--paper-mm,1mm))] [&_th]:py-[calc(1.0583*var(--paper-mm,1mm))]";

// The PDF has no heading rules, so the canvas copies the browser defaults (size, margin, inherited line height).
function headingClasses(canvas: boolean, page: boolean): string {
  return canvas
    ? cn(
        "[&_h1]:text-[length:2em] [&_h1]:leading-[inherit] [&_h1]:font-bold [&_h2]:text-[length:1.5em] [&_h2]:leading-[inherit] [&_h2]:font-bold [&_h3]:text-[length:1.17em] [&_h3]:leading-[inherit] [&_h3]:font-bold",
        page
          ? "[&_:is(h1,h2,h3)]:mt-0 [&_:is(h1,h2,h3)]:mb-(--doc-line)"
          : "[&_h1]:my-[0.67em] [&_h2]:my-[0.83em] [&_h3]:my-[1em]",
        " [&_:is(h1,h2,h3)_[data-variable-chip]]:text-[length:calc(var(--paper-font-size)*0.9)]",
      )
    : "[&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-bold";
}

function tableClasses(canvas: boolean, page: boolean): string {
  return canvas
    ? cn(
        page
          ? "[&_table]:mb-(--doc-line) [&_table]:mt-0 [&_.ProseMirror>.tableWrapper:last-child_table]:mb-0"
          : "[&_table]:mb-2 [&_table]:mt-6 [&_.ProseMirror>:first-child_table]:mt-0 [&_.ProseMirror>table:first-child]:mt-0",
        "[&_td:last-child>p[data-size=small][data-align=right]]:whitespace-nowrap",
      )
    : "[&_table]:my-2";
}

// The PDF prints cells top-aligned, header like body text and no rules unless the layout sets a
// table style; the dashed outline only marks the cells while editing, like the frame outline.
function cellClasses(canvas: boolean, print: DocumentPrintMode): string {
  return cn(
    print !== "none"
      ? cn(
          "[&_td]:align-top [&_th]:align-top [&_th]:font-bold",
          "[&_td]:outline-dashed [&_td]:outline-1 [&_td]:-outline-offset-1 [&_td]:outline-border [&_th]:outline-dashed [&_th]:outline-1 [&_th]:-outline-offset-1 [&_th]:outline-border",
        )
      : "[&_td]:border-b [&_td]:border-border [&_th]:border-b [&_th]:border-border [&_th]:text-xs [&_th]:text-muted-foreground",
    canvas ? CANVAS_CELL_PADDING_CLASS : "[&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5",
    print === "none" && (canvas ? "[&_th]:font-bold" : "[&_th]:font-medium"),
  );
}

export function renderEditorContent(
  editor: Editor,
  canvas: boolean,
  hosted: boolean,
  print: DocumentPrintMode,
): ReactNode {
  const page = print === "page";
  return (
    <EditorContent
      editor={editor}
      className={cn(
        !canvas && "min-h-40 px-3 py-2 text-base outline-none md:text-sm",
        canvas && "text-sm",
        "[&_.ProseMirror-focused_.ProseMirror-selectednode]:ring-2 [&_.ProseMirror-focused_.ProseMirror-selectednode]:ring-primary",
        hosted
          ? "[&_.ProseMirror]:outline-none"
          : "[&_.ProseMirror]:min-h-40 [&_.ProseMirror]:outline-none",
        // Frames are placed against the paper, so the editor root must not become their containing block.
        // Important: prosemirror's own unlayered `.ProseMirror{position:relative}` beats the utilities layer.
        print === "page" && "[&_.ProseMirror]:static!",
        // The PDF gives every body paragraph this spacing (see PRINT_CSS); cells and list items stay flush.
        page &&
          "[&_p]:mb-(--doc-line) [&_ul]:mb-(--doc-line) [&_ol]:mb-(--doc-line) [&_td>p]:mb-0 [&_th>p]:mb-0 [&_li>p]:mb-0 [&_td>:last-child]:mb-0 [&_th>:last-child]:mb-0 [&_li>:last-child]:mb-0 [&_.ProseMirror>:last-child]:mb-0",
        print !== "none" &&
          "[&_td]:relative [&_th]:relative [&_.column-resize-handle]:pointer-events-none [&_.column-resize-handle]:absolute [&_.column-resize-handle]:-right-0.5 [&_.column-resize-handle]:bottom-0 [&_.column-resize-handle]:top-0 [&_.column-resize-handle]:w-1 [&_.column-resize-handle]:bg-primary",
        "[&_[data-borders=none]_td]:border-transparent [&_[data-borders=none]_th]:border-transparent",
        "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6",
        headingClasses(canvas, page),
        "[&_a]:underline [&_a]:text-primary",
        "[&_strong]:font-bold [&_em]:italic [&_u]:underline",
        tableClasses(canvas, page),
        // A layout region has no content below its table; margins there only inflate the region box.
        hosted && "[&_td>div]:my-0 [&_.ProseMirror>.tableWrapper:last-child_table]:mb-0",
        "[&_table]:w-full [&_table]:border-collapse",
        "[&_td>p]:m-0 [&_th>p]:m-0 [&_th]:text-left",
        cellClasses(canvas, print),
        "[&_tr[data-each]>td]:bg-muted/50",
        "[&_[data-align=left]]:text-left [&_[data-align=center]]:text-center [&_[data-align=right]]:text-right [&_[data-align=justify]]:text-justify",
        "[&_p[data-size=small]]:text-xs [&_p[data-size=small]]:text-muted-foreground",
        "[&_a[data-button]]:inline-block [&_a[data-button]]:rounded-full [&_a[data-button]]:bg-primary [&_a[data-button]]:px-4 [&_a[data-button]]:py-1.5 [&_a[data-button]]:text-primary-foreground [&_a[data-button]]:no-underline",
        // A chip in the button would be primary on primary; it inverts to stay readable.
        "[&_a[data-button]_[data-variable-chip]]:border-primary-foreground/40 [&_a[data-button]_[data-variable-chip]]:bg-primary-foreground/15 [&_a[data-button]_[data-variable-chip]]:text-primary-foreground",
        "[&_hr]:my-3 [&_hr]:border-input",
        "[&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:float-left [&_.is-editor-empty]:before:h-0 [&_.is-editor-empty]:before:text-muted-foreground [&_.is-editor-empty]:before:content-[attr(data-placeholder)]",
      )}
    />
  );
}
