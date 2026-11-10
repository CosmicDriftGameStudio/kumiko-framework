import { cn, EditorToolbarPill } from "@cosmicdrift/kumiko-renderer/web";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  MoveVertical,
  Underline as UnderlineIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { DOCUMENT_FONT_LABELS, DOCUMENT_FONTS } from "./document-fonts.ts";
import type { TiptapContext } from "./document-tiptap-context.ts";
import {
  FONT_SIZES_PT,
  LINE_HEIGHTS,
  PARAGRAPH_SPACES_PT,
  setPrintBlockStyle,
  setPrintTextStyle,
  toggleTableBorders,
} from "./document-tiptap-helpers.ts";

export function Separator({ compact = false }: { readonly compact?: boolean }): ReactNode {
  return (
    <span aria-hidden="true" className={cn("h-5 w-px bg-border", compact ? "mx-0.5" : "mx-2")} />
  );
}

// Canvas chrome is one flat row: unframed ghost buttons, glyph plus text for the longer names.
export function iconButton(
  c: TiptapContext,
  label: string,
  icon: ReactNode,
  isActive: boolean,
  onClick: () => void,
  text?: string,
): ReactNode {
  const { Button, canvas, readOnly } = c;
  return canvas ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      pressed={isActive}
      disabled={readOnly}
      onClick={onClick}
      ariaLabel={label}
      title={label}
    >
      {icon}
      {text}
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
      title={label}
    >
      {icon}
    </Button>
  );
}

function markContent(
  canvas: boolean,
  letter: string,
  icon: ReactNode,
  className: string,
): ReactNode {
  return canvas ? <span className={className}>{letter}</span> : icon;
}

function FlatSelectBox({
  flat,
  widthClass,
  testId,
  children,
}: {
  readonly flat: boolean;
  readonly widthClass: string;
  readonly testId?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      data-testid={testId}
      // biome-ignore lint/plugin: the toolbar selects sit flush in the editor toolbar; ComboboxInput has no flat trigger variant
      className={cn(
        !flat && widthClass,
        flat &&
          "w-auto shrink-0 [&_button[aria-haspopup=listbox]]:border-transparent [&_button[aria-haspopup=listbox]]:bg-transparent [&_button[aria-haspopup=listbox]]:shadow-none",
      )}
    >
      {children}
    </div>
  );
}

export function renderParagraphStyleSelect(c: TiptapContext): ReactNode {
  const { t, Field, Input, id, canvas, compact, readOnly, activeState } = c;
  const paragraphStyleLabel = t("template-resolver.documentEditor.paragraphStyle");
  const styleOptions = [
    { value: "paragraph", label: t("template-resolver.documentEditor.paragraph") },
    { value: "1", label: t("kumiko.contentEditor.heading1") },
    { value: "2", label: t("kumiko.contentEditor.heading2") },
    { value: "3", label: t("template-resolver.documentEditor.heading3") },
  ];
  return (
    <FlatSelectBox flat={canvas} widthClass={compact ? "w-24" : "w-40"}>
      <Field id={`${id}-paragraph-style`} label={paragraphStyleLabel} hideLabel>
        <Input
          kind="select"
          id={`${id}-paragraph-style`}
          name="paragraph-style"
          value={activeState?.blockStyle ?? "paragraph"}
          onChange={c.setBlockStyle}
          options={styleOptions}
          display="dropdown"
          disabled={readOnly}
        />
      </Field>
    </FlatSelectBox>
  );
}

export function renderMarkButtons(c: TiptapContext): ReactNode {
  const { t, editor, canvas, activeState } = c;
  return (
    <>
      {iconButton(
        c,
        t("kumiko.contentEditor.bold"),
        markContent(canvas, "B", <BoldIcon size={16} />, "font-bold"),
        activeState?.bold ?? false,
        () => editor.chain().focus().toggleBold().run(),
      )}
      {iconButton(
        c,
        t("kumiko.contentEditor.italic"),
        markContent(canvas, "I", <ItalicIcon size={16} />, "italic"),
        activeState?.italic ?? false,
        () => editor.chain().focus().toggleItalic().run(),
      )}
      {iconButton(
        c,
        t("template-resolver.documentEditor.underline"),
        markContent(canvas, "U", <UnderlineIcon size={16} />, "underline"),
        activeState?.underline ?? false,
        () => editor.chain().focus().toggleUnderline().run(),
      )}
    </>
  );
}

export function renderListButtons(c: TiptapContext): ReactNode {
  const { t, editor, activeState } = c;
  return (
    <>
      {iconButton(
        c,
        t("kumiko.contentEditor.bulletList"),
        <List size={16} />,
        activeState?.bulletList ?? false,
        () => editor.chain().focus().toggleBulletList().run(),
      )}
      {iconButton(
        c,
        t("kumiko.contentEditor.orderedList"),
        <ListOrdered size={16} />,
        activeState?.orderedList ?? false,
        () => editor.chain().focus().toggleOrderedList().run(),
      )}
      {iconButton(
        c,
        t("template-resolver.documentEditor.link"),
        <LinkIcon size={16} />,
        activeState?.link ?? false,
        () => c.togglePanel("link"),
      )}
    </>
  );
}

const DEFAULT_OPTION_VALUE = "";
const FALLBACK_COLOR = "#000000";

function numberOptions(
  values: readonly number[],
  current: number | null,
  defaultLabel: string,
  format: (value: number) => string,
) {
  const all =
    current === null || values.includes(current)
      ? values
      : [...values, current].sort((a, b) => a - b);
  return [
    { value: DEFAULT_OPTION_VALUE, label: defaultLabel },
    ...all.map((value) => ({ value: String(value), label: format(value) })),
  ];
}

function parseOptionNumber(value: string): number | null {
  return value === DEFAULT_OPTION_VALUE ? null : Number(value);
}

type PrintSelectSpec = {
  readonly key: string;
  readonly leading?: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
};

function printSelect(c: TiptapContext, spec: PrintSelectSpec): ReactNode {
  const { Field, Input, id, readOnly } = c;
  const fieldId = `${id}-${spec.key}`;
  return (
    <EditorToolbarPill key={spec.key}>
      {spec.leading}
      <FlatSelectBox flat widthClass="" testId={`document-toolbar-${spec.key}`}>
        <Field id={fieldId} label={spec.label} hideLabel>
          <Input
            kind="select"
            id={fieldId}
            name={spec.key}
            value={spec.value}
            onChange={spec.onChange}
            options={spec.options}
            display="dropdown"
            disabled={readOnly}
          />
        </Field>
      </FlatSelectBox>
    </EditorToolbarPill>
  );
}

function colorPicker(
  c: TiptapContext,
  testId: string,
  label: string,
  value: string | null,
  onPick: (color: string | null) => void,
): ReactNode {
  return (
    <EditorToolbarPill>
      {/* biome-ignore lint/plugin: no color primitive exists and this toolbar is web-only; the native picker needs no extra widget */}
      <input
        type="color"
        data-testid={testId}
        aria-label={label}
        title={label}
        disabled={c.readOnly}
        value={value ?? FALLBACK_COLOR}
        onChange={(event) => onPick(event.target.value)}
        className="ml-1.5 h-5 w-5 cursor-pointer rounded border border-input bg-transparent p-0"
      />
      <span className="pr-2 pl-1.5 text-xs text-muted-foreground">{label}</span>
      {value !== null && (
        <c.Button
          type="button"
          variant="ghost"
          size="sm"
          ariaLabel={c.t("documentDesigner.editor.colorReset")}
          title={c.t("documentDesigner.editor.colorReset")}
          testId={`${testId}-reset`}
          onClick={() => onPick(null)}
        >
          ×
        </c.Button>
      )}
    </EditorToolbarPill>
  );
}

export function renderPrintTextStyleGroup(c: TiptapContext): ReactNode {
  const { t, editor } = c;
  const text = c.activeState?.textStyle ?? { font: null, sizePt: null, color: null };
  const block = c.activeState?.paragraphStyle ?? {
    lineHeight: null,
    spaceBeforePt: null,
    spaceAfterPt: null,
  };
  const defaults = c.printDefaults;
  const space = (
    key: string,
    label: string,
    defaultLabel: string,
    current: number | null,
    field: "spaceBeforePt" | "spaceAfterPt",
    format: (value: number) => string,
  ) =>
    printSelect(c, {
      key,
      label,
      value: current === null ? DEFAULT_OPTION_VALUE : String(current),
      options: numberOptions(PARAGRAPH_SPACES_PT, current, defaultLabel, format),
      onChange: (value) => setPrintBlockStyle(editor, { [field]: parseOptionNumber(value) }),
    });
  return (
    <>
      {printSelect(c, {
        key: "font",
        label: t("documentDesigner.editor.font"),
        value: text.font ?? DEFAULT_OPTION_VALUE,
        options: [
          { value: DEFAULT_OPTION_VALUE, label: defaults.font },
          ...DOCUMENT_FONTS.map((font) => ({ value: font, label: DOCUMENT_FONT_LABELS[font] })),
        ],
        onChange: (value) =>
          setPrintTextStyle(editor, { font: isOneOf(DOCUMENT_FONTS, value) ? value : null }),
      })}
      {printSelect(c, {
        key: "size",
        label: t("documentDesigner.editor.fontSize"),
        value: text.sizePt === null ? DEFAULT_OPTION_VALUE : String(text.sizePt),
        options: numberOptions(FONT_SIZES_PT, text.sizePt, defaults.size, defaults.formatSize),
        onChange: (value) => setPrintTextStyle(editor, { sizePt: parseOptionNumber(value) }),
      })}
      {colorPicker(
        c,
        "document-toolbar-color",
        t("documentDesigner.editor.textColor"),
        text.color,
        (color) => setPrintTextStyle(editor, { color }),
      )}
      <Separator compact={c.canvas} />
      {printSelect(c, {
        key: "line-height",
        leading: (
          <MoveVertical
            size={14}
            aria-hidden="true"
            className="ml-2 shrink-0 text-muted-foreground"
          />
        ),
        label: t("documentDesigner.editor.lineHeight"),
        value: block.lineHeight === null ? DEFAULT_OPTION_VALUE : String(block.lineHeight),
        options: numberOptions(
          LINE_HEIGHTS,
          block.lineHeight,
          defaults.lineHeight,
          defaults.formatLineHeight,
        ),
        onChange: (value) => setPrintBlockStyle(editor, { lineHeight: parseOptionNumber(value) }),
      })}
      {block.spaceBeforePt !== null &&
        space(
          "space-before",
          t("documentDesigner.editor.spaceBefore"),
          defaults.spaceBefore,
          block.spaceBeforePt,
          "spaceBeforePt",
          defaults.formatSpaceBefore,
        )}
      {space(
        "space-after",
        t("documentDesigner.editor.spaceAfter"),
        defaults.spaceAfter,
        block.spaceAfterPt,
        "spaceAfterPt",
        defaults.formatSpaceAfter,
      )}
    </>
  );
}

export function renderPrintTableGroup(c: TiptapContext): ReactNode {
  const { t, editor, Button } = c;
  const table = c.activeState?.printTable ?? null;
  if (table === null) return null;
  return (
    <>
      <EditorToolbarPill>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          pressed={!table.bordersOff}
          disabled={c.readOnly}
          testId="document-table-borders"
          onClick={() => toggleTableBorders(editor)}
        >
          {t("documentDesigner.editor.tableBorders")}
        </Button>
      </EditorToolbarPill>
      {colorPicker(
        c,
        "document-cell-color",
        t("documentDesigner.editor.cellColor"),
        table.cellBackground,
        (color) => editor.chain().focus().setCellAttribute("background", color).run(),
      )}
      <EditorToolbarPill>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={c.readOnly}
          testId="document-table-add-column"
          onClick={() => {
            editor.chain().focus().addColumnAfter().run();
          }}
        >
          {t("documentDesigner.editor.table.addColumn")}
        </Button>
      </EditorToolbarPill>
      <EditorToolbarPill>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={c.readOnly}
          testId="document-table-remove-column"
          onClick={() => {
            editor.chain().focus().deleteColumn().run();
          }}
        >
          {t("documentDesigner.editor.table.removeColumn")}
        </Button>
      </EditorToolbarPill>
    </>
  );
}
