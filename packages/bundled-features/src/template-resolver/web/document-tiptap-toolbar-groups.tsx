import { cn } from "@cosmicdrift/kumiko-renderer/web";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Underline as UnderlineIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { TiptapContext } from "./document-tiptap-context.ts";

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
    <div
      // kumiko-lint-ignore raw-classname the toolbar paragraph select sits flush in the editor toolbar; ComboboxInput has no flat trigger variant
      className={cn(
        !canvas && (compact ? "w-24" : "w-40"),
        canvas &&
          "w-auto shrink-0 [&_button[aria-haspopup=listbox]]:border-transparent [&_button[aria-haspopup=listbox]]:bg-transparent [&_button[aria-haspopup=listbox]]:shadow-none",
      )}
    >
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
    </div>
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
  const { t, editor, canvas, activeState } = c;
  return (
    <>
      {iconButton(
        c,
        t("kumiko.contentEditor.bulletList"),
        <List size={16} />,
        activeState?.bulletList ?? false,
        () => editor.chain().focus().toggleBulletList().run(),
        canvas ? undefined : t("template-resolver.documentEditor.list"),
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
