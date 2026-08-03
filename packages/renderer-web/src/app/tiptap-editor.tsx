// @runtime client
//
// tiptap-backed implementation behind RichContentEditor's lazy() boundary —
// never import this file directly, tiptap must only load when a "rich"
// collection is actually rendered. StarterKit covers bold/italic/lists/
// headings, and its bundled Link extension autolinks on type/paste — no
// link button, so no URL-prompt UI to build or test.

import {
  CONTENT_EDITOR_ELEMENT_ID,
  type ContentEditorProps,
  TextareaContentEditor,
  usePrimitives,
  useTranslation,
  VariableChips,
} from "@cosmicdrift/kumiko-renderer";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold as BoldIcon,
  Heading1,
  Heading2,
  Italic as ItalicIcon,
  List,
  ListOrdered,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { cn } from "../lib/cn";

type ToolbarAction = {
  readonly label: string;
  readonly icon: typeof BoldIcon;
  readonly isActive: boolean;
  readonly onClick: () => void;
};

function Toolbar({
  actions,
  disabled,
}: {
  readonly actions: readonly ToolbarAction[];
  readonly disabled: boolean;
}): ReactNode {
  const { Button } = usePrimitives();
  return (
    <div className="flex flex-wrap gap-1 border-b border-input p-1">
      {actions.map((action) => (
        <Button
          key={action.label}
          type="button"
          variant={action.isActive ? "primary" : "secondary"}
          size="icon"
          disabled={disabled}
          onClick={action.onClick}
          ariaLabel={action.label}
        >
          <action.icon size={16} />
        </Button>
      ))}
    </div>
  );
}

export default function TiptapEditor({
  value,
  onChange,
  variables,
  readOnly,
}: ContentEditorProps): ReactNode {
  const t = useTranslation();
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    editable: !readOnly,
    // Suspense (RichContentEditor's lazy boundary) speculatively mounts
    // this component before committing it; immediate render would create
    // an editor instance during that throwaway pass.
    immediatelyRender: false,
    // Same id the textarea fallback uses — the Field wrapping the editor
    // (TextBlockEditor) associates its label via this id; the editor
    // contract has no `id` prop of its own, see content-editors.tsx.
    editorProps: { attributes: { id: CONTENT_EDITOR_ELEMENT_ID } },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // TextBlockEditor loads the entry's content asynchronously (by-slug query
  // resolves after mount), so `value` arrives after useEditor already read
  // its initial (empty) content once. Sync it in — guarded against
  // clobbering in-flight typing by comparing against the editor's own HTML.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [readOnly, editor]);

  if (!editor)
    return (
      <TextareaContentEditor
        value={value}
        onChange={onChange}
        variables={variables}
        readOnly={readOnly}
      />
    );

  const actions: readonly ToolbarAction[] = [
    {
      label: t("kumiko.contentEditor.bold"),
      icon: BoldIcon,
      isActive: editor.isActive("bold"),
      onClick: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: t("kumiko.contentEditor.italic"),
      icon: ItalicIcon,
      isActive: editor.isActive("italic"),
      onClick: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: t("kumiko.contentEditor.heading1"),
      icon: Heading1,
      isActive: editor.isActive("heading", { level: 1 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: t("kumiko.contentEditor.heading2"),
      icon: Heading2,
      isActive: editor.isActive("heading", { level: 2 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: t("kumiko.contentEditor.bulletList"),
      icon: List,
      isActive: editor.isActive("bulletList"),
      onClick: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: t("kumiko.contentEditor.orderedList"),
      icon: ListOrdered,
      isActive: editor.isActive("orderedList"),
      onClick: () => editor.chain().focus().toggleOrderedList().run(),
    },
  ];

  const insertVariable = (name: string): void => {
    editor
      .chain()
      .focus()
      .insertContent({ type: "text", text: `{{${name}}}` })
      .run();
  };

  return (
    <div className="rounded-md border border-input bg-transparent">
      <Toolbar actions={actions} disabled={readOnly} />
      <EditorContent
        editor={editor}
        className={cn(
          "min-h-40 px-3 py-2 text-base outline-none md:text-sm",
          "[&_.ProseMirror]:min-h-40 [&_.ProseMirror]:outline-none",
          "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6",
          "[&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold",
          "[&_a]:underline [&_a]:text-primary",
          "[&_strong]:font-bold [&_em]:italic",
        )}
      />
      {variables.length > 0 && (
        <div className="border-t border-input p-1">
          <VariableChips variables={variables} onInsert={insertVariable} disabled={readOnly} />
        </div>
      )}
    </div>
  );
}
