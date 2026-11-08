import type { FieldTextRef } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "./types.ts";

export function fieldTextKey(ref: FieldTextRef): string {
  return typeof ref === "string" ? ref : ref.key;
}

/** Translates a label or help text, filling `{placeholder}`s from the form values (hidden
 *  fields included). `complete` is false while any referenced value is empty. */
export function resolveFieldText(
  ref: FieldTextRef,
  values: Readonly<Record<string, unknown>>,
  translate: Translate,
): { readonly text: string; readonly complete: boolean } {
  if (typeof ref === "string") return { text: translate(ref), complete: true };
  const params: Record<string, string> = {};
  let complete = true;
  for (const [placeholder, fieldName] of Object.entries(ref.params)) {
    const value = values[fieldName];
    const text = value === undefined || value === null ? "" : String(value);
    if (text === "") complete = false;
    params[placeholder] = text;
  }
  return { text: translate(ref.key, params), complete };
}
