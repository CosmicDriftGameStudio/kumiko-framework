import type { ReactNode } from "react";
import type { RenderInputArgs, SharedInputProps } from "./render-field-input-shared.ts";
import { resolveFieldIcon } from "./render-field-meta.ts";
import { stringValue } from "./render-field-values.ts";

function renderPasswordInput(
  { field, Input, onChange }: RenderInputArgs,
  { common }: SharedInputProps,
): ReactNode {
  return (
    <Input
      kind="password"
      {...common}
      value={stringValue(field.value)}
      onChange={(v) => onChange(v)}
    />
  );
}

function renderMonthInput(
  { field, Input, onChange }: RenderInputArgs,
  { common }: SharedInputProps,
): ReactNode {
  return (
    <Input
      kind="month"
      {...common}
      value={stringValue(field.value)}
      onChange={(v) => onChange(v)}
    />
  );
}

function renderTextareaInput(
  { field, Input, onChange }: RenderInputArgs,
  { common, placeholderProp }: SharedInputProps,
): ReactNode {
  const rows = typeof field.multiline === "object" ? field.multiline.rows : undefined;
  return (
    <Input
      kind="textarea"
      {...common}
      value={stringValue(field.value)}
      onChange={(v) => onChange(v)}
      {...(rows !== undefined && { rows })}
      {...placeholderProp}
    />
  );
}

function renderTextInput(
  { field, Input, onChange }: RenderInputArgs,
  { common, placeholderProp, affixProps }: SharedInputProps,
): ReactNode {
  const icon = resolveFieldIcon(field);
  return (
    <Input
      kind="text"
      {...common}
      value={stringValue(field.value)}
      onChange={(v) => onChange(v)}
      {...placeholderProp}
      {...affixProps}
      {...(icon !== undefined && { icon })}
      {...(field.autoComplete !== undefined && { autoComplete: field.autoComplete })}
    />
  );
}

// text + unknown scalar type → text input. If TextFieldDef.multiline
// is set (the view-model carries it), the renderer switches to
// textarea. longText always renders a textarea — that's the point of
// the type — regardless of whether `multiline` is set; `multiline`
// only supplies an optional `{ rows }` override for it.
export function renderFallbackInput(args: RenderInputArgs, shared: SharedInputProps): ReactNode {
  const { field } = args;
  if (field.type === "text" && field.format === "password") {
    return renderPasswordInput(args, shared);
  }
  if (field.type === "text" && field.format === "month") return renderMonthInput(args, shared);
  if (field.type === "longText" || (field.type === "text" && field.multiline)) {
    return renderTextareaInput(args, shared);
  }
  return renderTextInput(args, shared);
}
