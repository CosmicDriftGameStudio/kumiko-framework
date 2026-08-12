// @runtime client
//
// tiptap-backed implementation behind RichContentEditor's lazy() boundary —
// never import this file directly, tiptap must only load when a "rich"
// collection is actually rendered. StarterKit covers bold/italic/lists/
// headings, and its bundled Link extension autolinks on type/paste — no
// link button, so no URL-prompt UI to build or test.

import {
  type ContentEditorProps,
  TextareaContentEditor,
  usePrimitives,
  useTranslation,
  VariableChips,
} from "@cosmicdrift/kumiko-renderer";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
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
  id,
  value,
  onChange,
  variables,
  readOnly,
}: ContentEditorProps): ReactNode {
  const t = useTranslation();
  // ponytail: rich = StarterKit's schema (bold/italic/lists/headings/links).
  // Anything the schema doesn't model — <table>, <div>/<span>, style attrs,
  // <img>, classes — is dropped on first parse (setContent below, and the
  // initial `content: value` here). Upgrade if that ceiling is hit: add the
  // matching tiptap extensions, or a raw-HTML mode for markup StarterKit
  // can't represent.
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    editable: !readOnly,
    // Suspense (RichContentEditor's lazy boundary) speculatively mounts
    // this component before committing it; immediate render would create
    // an editor instance during that throwaway pass.
    immediatelyRender: false,
    // Caller-supplied id — the Field wrapping the editor (TextBlockEditor)
    // associates its label via this id, see ContentEditorProps.id in
    // content-editors.tsx.
    editorProps: { attributes: { id } },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // `useEditor` alone leaves `editor.isActive(...)` reads in the render body
  // frozen on the last prop-driven render — @tiptap/react v3 defaults
  // `shouldRerenderOnTransaction` to false, so a selection-only change (e.g.
  // moving the cursor into bold text without typing) never triggers a
  // re-render on its own. `useEditorState` subscribes to transactions itself
  // and only re-renders when the selected slice of state actually changes.
  const activeState = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e === null
        ? null
        : {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            heading1: e.isActive("heading", { level: 1 }),
            heading2: e.isActive("heading", { level: 2 }),
            bulletList: e.isActive("bulletList"),
            orderedList: e.isActive("orderedList"),
          },
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
        id={id}
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
      isActive: activeState?.bold ?? false,
      onClick: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: t("kumiko.contentEditor.italic"),
      icon: ItalicIcon,
      isActive: activeState?.italic ?? false,
      onClick: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: t("kumiko.contentEditor.heading1"),
      icon: Heading1,
      isActive: activeState?.heading1 ?? false,
      onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: t("kumiko.contentEditor.heading2"),
      icon: Heading2,
      isActive: activeState?.heading2 ?? false,
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: t("kumiko.contentEditor.bulletList"),
      icon: List,
      isActive: activeState?.bulletList ?? false,
      onClick: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: t("kumiko.contentEditor.orderedList"),
      icon: ListOrdered,
      isActive: activeState?.orderedList ?? false,
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
