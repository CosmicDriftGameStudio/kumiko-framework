import { cn } from "@cosmicdrift/kumiko-renderer/web";
import type { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import type { ReactNode } from "react";

export function renderEditorContent(editor: Editor, canvas: boolean, hosted: boolean): ReactNode {
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
        "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6",
        "[&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-bold",
        "[&_a]:underline [&_a]:text-primary",
        "[&_strong]:font-bold [&_em]:italic [&_u]:underline",
        canvas
          ? "[&_table]:mb-2 [&_table]:mt-6 [&_.ProseMirror>:first-child_table]:mt-0 [&_.ProseMirror>table:first-child]:mt-0 [&_td:last-child>p[data-size=small][data-align=right]]:whitespace-nowrap"
          : "[&_table]:my-2",
        "[&_table]:w-full [&_table]:border-collapse",
        "[&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_td>p]:m-0 [&_th>p]:m-0",
        "[&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground",
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
