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
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
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
  Underline as UnderlineIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  DOCUMENT_TEXT_ALIGNMENTS,
  type DocumentTextAlignment,
  isAllowedDocumentLinkHref,
  isDocumentPlaceholderHref,
  isDocumentReferenceName,
  isDocumentResourceKey,
} from "../document-schema.js";
import { createDocumentEditorExtensions } from "./document-editor-extensions.js";
import {
  type DocumentEditorProps,
  type DocumentResourcePreview,
  type DocumentToolbarBlock,
  MAIL_DOCUMENT_BLOCKS,
} from "./document-toolbar-blocks.js";
import { createEditorHandle } from "./editor-handle.js";
import { useStableByKey } from "./use-stable-by-key.js";

const NO_LABELS: Readonly<Record<string, string>> = {};
const NO_NAMES: readonly string[] = [];
const NO_PREVIEWS: Readonly<Record<string, DocumentResourcePreview>> = {};

function previewsKey(previews: Readonly<Record<string, DocumentResourcePreview>>): string {
  return Object.entries(previews)
    .map(([key, { src, caption }]) => `${key}|${src.length}|${src.slice(-24)}|${caption ?? ""}`)
    .join("\n");
}

type PanelKind = "link" | "placeholder" | "image" | "button" | "repeat" | "align";

const BLOCK_PANEL: Partial<Record<DocumentToolbarBlock, PanelKind>> = {
  image: "image",
  button: "button",
  repeat: "repeat",
  align: "align",
};

const ALIGNMENT_ICONS: Record<DocumentTextAlignment, ReactNode> = {
  left: <AlignLeft size={16} />,
  center: <AlignCenter size={16} />,
  right: <AlignRight size={16} />,
  justify: <AlignJustify size={16} />,
};

const ALIGNMENT_LABEL_KEYS: Record<DocumentTextAlignment, string> = {
  left: "template-resolver.documentEditor.alignLeft",
  center: "template-resolver.documentEditor.alignCenter",
  right: "template-resolver.documentEditor.alignRight",
  justify: "template-resolver.documentEditor.alignJustify",
};

type RepeatTableState = {
  readonly lists: readonly string[];
  readonly headerRepeats: boolean;
  readonly firstRowPos: number;
};

// print-document moves the leading rows flagged repeatHeader into thead, so the
// toggle reads and writes the table's first row.
function findRepeatTable(editor: Editor): RepeatTableState | null {
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

function toggleRepeatHeader(editor: Editor): void {
  const found = findRepeatTable(editor);
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
  const { Button, Field, Input } = usePrimitives();
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
      {kind === "align" && (
        <div className="flex flex-wrap gap-1">
          {DOCUMENT_TEXT_ALIGNMENTS.map((alignment) => (
            <Button
              key={alignment}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .updateAttributes("paragraph", { textAlign: alignment })
                  .updateAttributes("heading", { textAlign: alignment })
                  .run();
                onClose();
              }}
            >
              {ALIGNMENT_ICONS[alignment]}
              {t(ALIGNMENT_LABEL_KEYS[alignment])}
            </Button>
          ))}
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
  variableLabels = NO_LABELS,
  systemVariables = NO_NAMES,
  resourcePreviews = NO_PREVIEWS,
  chrome = "default",
  onEditorReady,
}: DocumentEditorProps): ReactNode {
  const t = useTranslation();
  const { Button, Field, Input } = usePrimitives();
  const [openPanel, setOpenPanel] = useState<PanelKind | null>(null);
  const [showHtml, setShowHtml] = useState(false);
  const canvas = chrome === "canvas";

  const placeholderLabel = t("template-resolver.documentEditor.placeholder");
  const imageLabel = t("template-resolver.documentEditor.image");
  const pageBreakLabel = t("template-resolver.documentEditor.pageBreak");
  const buttonLabel = t("template-resolver.documentEditor.button");
  const stableLabels = useStableByKey(variableLabels, JSON.stringify(variableLabels));
  const stableSystem = useStableByKey(systemVariables, systemVariables.join("\n"));
  const stablePreviews = useStableByKey(resourcePreviews, previewsKey(resourcePreviews));
  const extensions = useMemo(
    () =>
      createDocumentEditorExtensions({
        placeholder: placeholderLabel,
        image: imageLabel,
        pageBreak: pageBreakLabel,
        button: buttonLabel,
        variableLabels: stableLabels,
        systemVariables: stableSystem,
        resourcePreviews: stablePreviews,
        blockLabels: canvas,
      }),
    [
      placeholderLabel,
      imageLabel,
      pageBreakLabel,
      buttonLabel,
      stableLabels,
      stableSystem,
      stablePreviews,
      canvas,
    ],
  );

  // The node views are built from labels and previews, so a changed set
  // rebuilds the editor; its content is re-read from `value`.
  const editor = useEditor(
    {
      extensions,
      content: value,
      editable: !readOnly,
      // Suspense (DocumentContentEditor's lazy boundary) speculatively mounts
      // this component before committing it; immediate render would create an
      // editor instance during that throwaway pass.
      immediatelyRender: false,
      editorProps: { attributes: { id } },
      onCreate: ({ editor: created }) => onEditorReady?.(createEditorHandle(created)),
      onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    },
    [extensions],
  );

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
            underline: e.isActive("underline"),
            selectedBlock: e.isActive("resource")
              ? {
                  type: "resource" as const,
                  detail: String(e.getAttributes("resource")["resource"]),
                }
              : e.isActive("button")
                ? { type: "button" as const, detail: String(e.getAttributes("button")["href"]) }
                : null,
            html: showHtml ? e.getHTML() : "",
            bulletList: e.isActive("bulletList"),
            orderedList: e.isActive("orderedList"),
            link: e.isActive("link"),
            repeatTable: findRepeatTable(e),
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
    align: { label: t("template-resolver.documentEditor.align"), icon: <AlignLeft size={16} /> },
  };

  const repeatTable = activeState?.repeatTable ?? null;
  const repeatListLabel =
    repeatTable !== null && repeatTable.lists.length === 1
      ? (variableLabels[repeatTable.lists[0] ?? ""] ?? repeatTable.lists[0])
      : undefined;

  const paragraphStyleLabel = t("template-resolver.documentEditor.paragraphStyle");
  const styleOptions = [
    { value: "paragraph", label: t("template-resolver.documentEditor.paragraph") },
    { value: "1", label: t("kumiko.contentEditor.heading1") },
    { value: "2", label: t("kumiko.contentEditor.heading2") },
    { value: "3", label: t("template-resolver.documentEditor.heading3") },
  ];

  // Canvas chrome shows plain text buttons instead of icons.
  const iconButton = (
    label: string,
    icon: ReactNode,
    isActive: boolean,
    onClick: () => void,
  ): ReactNode =>
    canvas ? (
      <Button
        type="button"
        variant={isActive ? "secondary" : "ghost"}
        size="sm"
        pressed={isActive}
        disabled={readOnly}
        onClick={onClick}
        ariaLabel={label}
      >
        {icon}
      </Button>
    ) : (
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

  const markContent = (letter: string, icon: ReactNode, className: string): ReactNode =>
    canvas ? <span className={className}>{letter}</span> : icon;
  const selectedBlock = activeState?.selectedBlock ?? null;

  const flatVariant = canvas ? "ghost" : "secondary";

  return (
    <div
      className={cn("rounded-md border border-input", canvas ? "bg-background" : "bg-transparent")}
    >
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
          markContent("B", <BoldIcon size={16} />, "font-bold"),
          activeState?.bold ?? false,
          () => editor.chain().focus().toggleBold().run(),
        )}
        {iconButton(
          t("kumiko.contentEditor.italic"),
          markContent("I", <ItalicIcon size={16} />, "italic"),
          activeState?.italic ?? false,
          () => editor.chain().focus().toggleItalic().run(),
        )}
        {iconButton(
          t("template-resolver.documentEditor.underline"),
          markContent("U", <UnderlineIcon size={16} />, "underline"),
          activeState?.underline ?? false,
          () => editor.chain().focus().toggleUnderline().run(),
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
          variant={flatVariant}
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
            variant={flatVariant}
            size="sm"
            disabled={readOnly}
            onClick={() => runBlock(block)}
          >
            {!canvas && blockButtons[block].icon}
            {blockButtons[block].label}
          </Button>
        ))}
        {canvas && (
          <>
            <span className="flex-1" />
            <Button
              type="button"
              variant={flatVariant}
              size="sm"
              expanded={showHtml}
              onClick={() => {
                setShowHtml((current) => !current);
              }}
            >
              {t("template-resolver.documentEditor.showHtml")}
            </Button>
          </>
        )}
      </div>
      {canvas && selectedBlock !== null && !readOnly && (
        <div className="flex items-center gap-2 border-b border-input bg-muted/40 px-2 py-1 text-sm">
          <span className="text-muted-foreground">
            {t("template-resolver.documentEditor.selectedBlock")}
          </span>
          <span className="font-medium">
            {selectedBlock.type === "resource" ? imageLabel : buttonLabel}
          </span>
          <code className="text-xs text-muted-foreground">{selectedBlock.detail}</code>
          <span className="flex-1" />
          <Button
            type="button"
            size="sm"
            variant="danger-ghost"
            onClick={() => {
              editor.chain().focus().deleteNode(selectedBlock.type).run();
            }}
          >
            {t("template-resolver.documentEditor.removeBlock")}
          </Button>
        </div>
      )}
      {canvas && showHtml && (
        <section aria-label={t("template-resolver.documentEditor.htmlSource")}>
          <pre className="h-40 overflow-auto whitespace-pre-wrap break-all border-b border-input bg-muted p-2 font-mono text-xs">
            {activeState?.html ?? ""}
          </pre>
        </section>
      )}
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
      {repeatTable !== null && !readOnly && (
        <div
          data-testid="document-repeat-bar"
          className="flex flex-wrap items-center gap-3 border-b border-input bg-muted/40 px-2 py-1 text-xs"
        >
          <span className="font-medium">
            {repeatListLabel === undefined
              ? t("template-resolver.documentEditor.repeat")
              : t("template-resolver.documentEditor.repeatBarList", { list: repeatListLabel })}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            pressed={repeatTable.headerRepeats}
            onClick={() => toggleRepeatHeader(editor)}
          >
            {t("template-resolver.documentEditor.repeatHeader")}
          </Button>
          <span className="text-muted-foreground">
            {t("template-resolver.documentEditor.keepRowsTogether")}
          </span>
        </div>
      )}
      <div className={cn(canvas && "flex justify-center bg-muted p-6")}>
        <EditorContent
          editor={editor}
          className={cn(
            canvas
              ? "w-[600px] max-w-full bg-background px-10 py-7 text-sm border border-input"
              : "min-h-40 px-3 py-2 text-base outline-none md:text-sm",
            "[&_.ProseMirror-selectednode]:ring-2 [&_.ProseMirror-selectednode]:ring-primary",
            "[&_.ProseMirror]:min-h-40 [&_.ProseMirror]:outline-none",
            "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6",
            "[&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-bold",
            "[&_a]:underline [&_a]:text-primary",
            "[&_strong]:font-bold [&_em]:italic [&_u]:underline",
            "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
            "[&_td]:border [&_td]:border-input [&_td]:p-1 [&_th]:border [&_th]:border-input [&_th]:bg-muted [&_th]:p-1 [&_th]:text-left",
            "[&_tr[data-each]]:bg-muted",
            "[&_a[data-button]]:inline-block [&_a[data-button]]:rounded-full [&_a[data-button]]:bg-primary [&_a[data-button]]:px-4 [&_a[data-button]]:py-1.5 [&_a[data-button]]:text-primary-foreground [&_a[data-button]]:no-underline",
            "[&_hr]:my-3 [&_hr]:border-input",
            "[&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:float-left [&_.is-editor-empty]:before:h-0 [&_.is-editor-empty]:before:text-muted-foreground [&_.is-editor-empty]:before:content-[attr(data-placeholder)]",
          )}
        />
      </div>
    </div>
  );
}
