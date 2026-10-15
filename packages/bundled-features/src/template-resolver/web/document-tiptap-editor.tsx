// @runtime client
//
// tiptap-backed implementation behind DocumentContentEditor's lazy() boundary —
// never import this file statically, tiptap must only load when a "document"
// collection is rendered. Variables are inserted as `variable` nodes only,
// never as `{{name}}` text, so the sanitizer's schema keeps them.

import {
  TextareaContentEditor,
  usePrimitives,
  useTranslation,
  VariableChips,
} from "@cosmicdrift/kumiko-renderer";
import { cn } from "@cosmicdrift/kumiko-renderer-web";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import {
  Bold as BoldIcon,
  Braces,
  Image as ImageIcon,
  Italic as ItalicIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  MousePointerClick,
  Repeat,
  Scissors,
  Table as TableIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  isAllowedDocumentLinkHref,
  isDocumentPlaceholderHref,
  isDocumentReferenceName,
  isDocumentResourceKey,
} from "../document-schema.js";
import { createDocumentEditorExtensions } from "./document-editor-extensions.js";
import {
  type DocumentEditorProps,
  type DocumentToolbarBlock,
  MAIL_DOCUMENT_BLOCKS,
} from "./document-toolbar-blocks.js";

type PanelKind = "link" | "placeholder" | "image" | "button" | "repeat";

const BLOCK_PANEL: Partial<Record<DocumentToolbarBlock, PanelKind>> = {
  image: "image",
  button: "button",
  repeat: "repeat",
};

const PARAGRAPH_STYLES = ["paragraph", "1", "2", "3"] as const;
type ParagraphStyle = (typeof PARAGRAPH_STYLES)[number];

const HEADING_LEVELS = { "1": 1, "2": 2, "3": 3 } as const;

function isParagraphStyle(value: string): value is ParagraphStyle {
  return isOneOf(PARAGRAPH_STYLES, value);
}

function emptyParagraph(): JSONContent {
  return { type: "paragraph" };
}

function repeatTableContent(listName: string): JSONContent {
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

function Separator(): ReactNode {
  return <span aria-hidden="true" className="mx-2 h-5 w-px bg-border" />;
}

function PanelActions({
  onInsert,
  onRemoveLink,
  onCancel,
}: {
  readonly onInsert?: () => void;
  readonly onRemoveLink?: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const { Button } = usePrimitives();
  const t = useTranslation();
  return (
    <div className="flex gap-2">
      {onInsert && (
        <Button type="button" size="sm" onClick={onInsert}>
          {t("template-resolver.documentEditor.insert")}
        </Button>
      )}
      {onRemoveLink && (
        <Button type="button" size="sm" variant="danger-ghost" onClick={onRemoveLink}>
          {t("template-resolver.documentEditor.removeLink")}
        </Button>
      )}
      <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
        {t("template-resolver.documentEditor.cancel")}
      </Button>
    </div>
  );
}

type OptionSelectProps = {
  readonly id: string;
  readonly label: string;
  readonly names: readonly string[];
  readonly value: string;
  readonly onChange: (name: string) => void;
};

function NameSelect({ id, label, names, value, onChange }: OptionSelectProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={label}>
      <Input
        kind="select"
        id={id}
        name={id}
        value={value}
        onChange={onChange}
        display="dropdown"
        options={names.map((name) => ({ value: name, label: name }))}
      />
    </Field>
  );
}

type PanelProps = {
  readonly editor: Editor;
  readonly editorId: string;
  readonly kind: PanelKind;
  readonly variables: readonly string[];
  readonly onClose: () => void;
};

function InsertPanel({ editor, editorId, kind, variables, onClose }: PanelProps): ReactNode {
  const { Field, Input } = usePrimitives();
  const t = useTranslation();
  const [href, setHref] = useState(() => {
    const current = editor.getAttributes("link")["href"];
    return typeof current === "string" ? current : "";
  });
  const [resource, setResource] = useState("");
  const [alt, setAlt] = useState("");
  const [buttonText, setButtonText] = useState(() =>
    t("template-resolver.documentEditor.buttonDefaultText"),
  );
  const [chosenName, setChosenName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const referenceNames = variables.filter(isDocumentReferenceName);
  const buttonTargets = referenceNames.filter((name) => isDocumentPlaceholderHref(`{{${name}}}`));
  const selectable = kind === "button" ? buttonTargets : referenceNames;
  const selectedName = selectable.includes(chosenName) ? chosenName : (selectable[0] ?? "");

  const insertAndClose = (content: JSONContent): void => {
    editor.chain().focus().insertContent(content).run();
    onClose();
  };

  const submitLink = (): void => {
    if (!isAllowedDocumentLinkHref(href)) {
      setError(t("template-resolver.documentEditor.invalidLink"));
      return;
    }
    const chain = editor.chain().focus();
    if (!editor.state.selection.empty) chain.setLink({ href }).run();
    else if (editor.isActive("link")) chain.extendMarkRange("link").setLink({ href }).run();
    else
      chain
        .insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] })
        .run();
    onClose();
  };

  const submitImage = (): void => {
    if (!isDocumentResourceKey(resource)) {
      setError(t("template-resolver.documentEditor.invalidResourceKey"));
      return;
    }
    if (/[<>]/.test(alt)) {
      setError(t("template-resolver.documentEditor.invalidImageAlt"));
      return;
    }
    insertAndClose({ type: "resource", attrs: { resource, alt: alt || null } });
  };

  const needsVariables = kind === "button" || kind === "repeat" || kind === "placeholder";
  const noVariables = needsVariables && selectable.length === 0;
  const idPrefix = `${editorId}-panel`;

  return (
    <div className="flex flex-col gap-2 border-b border-input bg-muted/40 p-2">
      {noVariables && (
        <p className="text-sm text-muted-foreground">
          {t("template-resolver.documentEditor.noVariables")}
        </p>
      )}
      {kind === "link" && (
        <Field id={`${idPrefix}-href`} label={t("template-resolver.documentEditor.linkHref")}>
          <Input
            kind="text"
            id={`${idPrefix}-href`}
            name="href"
            value={href}
            onChange={setHref}
            placeholder={t("template-resolver.documentEditor.linkHrefPlaceholder")}
          />
        </Field>
      )}
      {kind === "placeholder" && !noVariables && (
        <div className="flex flex-wrap gap-1">
          <VariableChips
            variables={selectable}
            onInsert={(name) => insertAndClose({ type: "variable", attrs: { name } })}
          />
        </div>
      )}
      {kind === "image" && (
        <>
          <Field
            id={`${idPrefix}-resource`}
            label={t("template-resolver.documentEditor.resourceKey")}
          >
            <Input
              kind="text"
              id={`${idPrefix}-resource`}
              name="resource"
              value={resource}
              onChange={setResource}
            />
          </Field>
          <Field id={`${idPrefix}-alt`} label={t("template-resolver.documentEditor.imageAlt")}>
            <Input kind="text" id={`${idPrefix}-alt`} name="alt" value={alt} onChange={setAlt} />
          </Field>
        </>
      )}
      {kind === "button" && !noVariables && (
        <>
          <NameSelect
            id={`${idPrefix}-target`}
            label={t("template-resolver.documentEditor.buttonTarget")}
            names={selectable}
            value={selectedName}
            onChange={setChosenName}
          />
          <Field id={`${idPrefix}-text`} label={t("template-resolver.documentEditor.buttonText")}>
            <Input
              kind="text"
              id={`${idPrefix}-text`}
              name="text"
              value={buttonText}
              onChange={setButtonText}
            />
          </Field>
        </>
      )}
      {kind === "repeat" && !noVariables && (
        <NameSelect
          id={`${idPrefix}-list`}
          label={t("template-resolver.documentEditor.repeatList")}
          names={selectable}
          value={selectedName}
          onChange={setChosenName}
        />
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <PanelActions
          onCancel={onClose}
          {...(kind === "link" && { onInsert: submitLink })}
          {...(kind === "link" &&
            editor.isActive("link") && {
              onRemoveLink: () => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                onClose();
              },
            })}
          {...(kind === "image" && { onInsert: submitImage })}
          {...(kind === "button" &&
            !noVariables && {
              onInsert: () =>
                insertAndClose({
                  type: "button",
                  attrs: { href: `{{${selectedName}}}` },
                  content: buttonText ? [{ type: "text", text: buttonText }] : [],
                }),
            })}
          {...(kind === "repeat" &&
            !noVariables && { onInsert: () => insertAndClose(repeatTableContent(selectedName)) })}
        />
      </div>
    </div>
  );
}

export default function DocumentTiptapEditor({
  id,
  value,
  onChange,
  variables,
  readOnly,
  blocks = MAIL_DOCUMENT_BLOCKS,
}: DocumentEditorProps): ReactNode {
  const t = useTranslation();
  const { Button, Field, Input } = usePrimitives();
  const [openPanel, setOpenPanel] = useState<PanelKind | null>(null);

  const placeholderLabel = t("template-resolver.documentEditor.placeholder");
  const imageLabel = t("template-resolver.documentEditor.image");
  const pageBreakLabel = t("template-resolver.documentEditor.pageBreak");
  const extensions = useMemo(
    () =>
      createDocumentEditorExtensions({
        placeholder: placeholderLabel,
        image: imageLabel,
        pageBreak: pageBreakLabel,
      }),
    [placeholderLabel, imageLabel, pageBreakLabel],
  );

  const editor = useEditor({
    extensions,
    content: value,
    editable: !readOnly,
    // Suspense (DocumentContentEditor's lazy boundary) speculatively mounts
    // this component before committing it; immediate render would create an
    // editor instance during that throwaway pass.
    immediatelyRender: false,
    editorProps: { attributes: { id } },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // @tiptap/react v3 does not re-render on selection-only transactions, so
  // active states must come from a subscription.
  const activeState = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e === null
        ? null
        : {
            blockStyle: e.isActive("heading", { level: 1 })
              ? "1"
              : e.isActive("heading", { level: 2 })
                ? "2"
                : e.isActive("heading", { level: 3 })
                  ? "3"
                  : "paragraph",
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            bulletList: e.isActive("bulletList"),
            orderedList: e.isActive("orderedList"),
            link: e.isActive("link"),
          },
  });

  // The entry loads asynchronously, so `value` arrives after useEditor read
  // its initial content; the guard keeps in-flight typing from being clobbered.
  // kumiko-lint-ignore no-raw-hooks DOM integration: syncs the controlled value into the imperative tiptap editor
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  // kumiko-lint-ignore no-raw-hooks DOM integration: tiptap exposes editability only imperatively via setEditable
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

  const togglePanel = (kind: PanelKind): void =>
    setOpenPanel((current) => (current === kind ? null : kind));

  const setBlockStyle = (style: string): void => {
    if (!isParagraphStyle(style)) return;
    const chain = editor.chain().focus();
    if (style === "paragraph") chain.setParagraph().run();
    else chain.setHeading({ level: HEADING_LEVELS[style] }).run();
  };

  const runBlock = (block: DocumentToolbarBlock): void => {
    const panel = BLOCK_PANEL[block];
    if (panel) {
      togglePanel(panel);
      return;
    }
    const chain = editor.chain().focus();
    if (block === "table") chain.insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
    else if (block === "divider") chain.insertContent({ type: "divider" }).run();
    else if (block === "pageBreak") chain.insertContent({ type: "pageBreak" }).run();
  };

  const blockButtons: Record<DocumentToolbarBlock, { label: string; icon: ReactNode }> = {
    image: { label: imageLabel, icon: <ImageIcon size={16} /> },
    table: { label: t("template-resolver.documentEditor.table"), icon: <TableIcon size={16} /> },
    button: {
      label: t("template-resolver.documentEditor.button"),
      icon: <MousePointerClick size={16} />,
    },
    divider: { label: t("template-resolver.documentEditor.divider"), icon: <Minus size={16} /> },
    repeat: { label: t("template-resolver.documentEditor.repeat"), icon: <Repeat size={16} /> },
    pageBreak: { label: pageBreakLabel, icon: <Scissors size={16} /> },
  };

  const paragraphStyleLabel = t("template-resolver.documentEditor.paragraphStyle");
  const styleOptions = [
    { value: "paragraph", label: t("template-resolver.documentEditor.paragraph") },
    { value: "1", label: t("kumiko.contentEditor.heading1") },
    { value: "2", label: t("kumiko.contentEditor.heading2") },
    { value: "3", label: t("template-resolver.documentEditor.heading3") },
  ];

  const iconButton = (
    label: string,
    icon: ReactNode,
    isActive: boolean,
    onClick: () => void,
  ): ReactNode => (
    <Button
      type="button"
      variant={isActive ? "primary" : "secondary"}
      size="icon"
      pressed={isActive}
      disabled={readOnly}
      onClick={onClick}
      ariaLabel={label}
    >
      {icon}
    </Button>
  );

  return (
    <div className="rounded-md border border-input bg-transparent">
      <div className="flex flex-wrap items-center gap-1 border-b border-input p-1">
        <div className="w-40">
          <Field id={`${id}-paragraph-style`} label={paragraphStyleLabel} hideLabel>
            <Input
              kind="select"
              id={`${id}-paragraph-style`}
              name="paragraph-style"
              value={activeState?.blockStyle ?? "paragraph"}
              onChange={setBlockStyle}
              options={styleOptions}
              display="dropdown"
              disabled={readOnly}
            />
          </Field>
        </div>
        <Separator />
        {iconButton(
          t("kumiko.contentEditor.bold"),
          <BoldIcon size={16} />,
          activeState?.bold ?? false,
          () => editor.chain().focus().toggleBold().run(),
        )}
        {iconButton(
          t("kumiko.contentEditor.italic"),
          <ItalicIcon size={16} />,
          activeState?.italic ?? false,
          () => editor.chain().focus().toggleItalic().run(),
        )}
        <Separator />
        {iconButton(
          t("kumiko.contentEditor.bulletList"),
          <List size={16} />,
          activeState?.bulletList ?? false,
          () => editor.chain().focus().toggleBulletList().run(),
        )}
        {iconButton(
          t("kumiko.contentEditor.orderedList"),
          <ListOrdered size={16} />,
          activeState?.orderedList ?? false,
          () => editor.chain().focus().toggleOrderedList().run(),
        )}
        {iconButton(
          t("template-resolver.documentEditor.link"),
          <LinkIcon size={16} />,
          activeState?.link ?? false,
          () => togglePanel("link"),
        )}
        <Separator />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          expanded={openPanel === "placeholder"}
          disabled={readOnly}
          onClick={() => togglePanel("placeholder")}
        >
          <Braces size={16} />
          {t("template-resolver.documentEditor.insertPlaceholder")}
        </Button>
        {blocks.length > 0 && <Separator />}
        {blocks.map((block) => (
          <Button
            key={block}
            type="button"
            variant="secondary"
            size="sm"
            disabled={readOnly}
            onClick={() => runBlock(block)}
          >
            {blockButtons[block].icon}
            {blockButtons[block].label}
          </Button>
        ))}
      </div>
      {openPanel !== null && !readOnly && (
        <InsertPanel
          key={openPanel}
          editor={editor}
          editorId={id}
          kind={openPanel}
          variables={variables}
          onClose={() => setOpenPanel(null)}
        />
      )}
      <EditorContent
        editor={editor}
        className={cn(
          "min-h-40 px-3 py-2 text-base outline-none md:text-sm",
          "[&_.ProseMirror]:min-h-40 [&_.ProseMirror]:outline-none",
          "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6",
          "[&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-bold",
          "[&_a]:underline [&_a]:text-primary",
          "[&_strong]:font-bold [&_em]:italic",
          "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
          "[&_td]:border [&_td]:border-input [&_td]:p-1 [&_th]:border [&_th]:border-input [&_th]:bg-muted [&_th]:p-1 [&_th]:text-left",
          "[&_tr[data-each]]:bg-muted",
          "[&_a[data-button]]:inline-block [&_a[data-button]]:rounded-full [&_a[data-button]]:bg-primary [&_a[data-button]]:px-4 [&_a[data-button]]:py-1.5 [&_a[data-button]]:text-primary-foreground [&_a[data-button]]:no-underline",
          "[&_hr]:my-3 [&_hr]:border-input",
          "[&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:float-left [&_.is-editor-empty]:before:h-0 [&_.is-editor-empty]:before:text-muted-foreground [&_.is-editor-empty]:before:content-[attr(data-placeholder)]",
        )}
      />
    </div>
  );
}
