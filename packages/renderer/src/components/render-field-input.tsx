import type { ReactNode } from "react";
import {
  renderFileInput,
  renderFileListInput,
  renderMultiSelectInput,
  renderSelectInput,
  renderUnsupportedInput,
} from "./render-field-choice-inputs.tsx";
import {
  type InputRenderer,
  type RenderInputArgs,
  sharedInputProps,
} from "./render-field-input-shared.ts";
import {
  renderBooleanInput,
  renderDateInput,
  renderDecimalInput,
  renderLocatedTimestampInput,
  renderMoneyInput,
  renderNumberInput,
  renderTimestampInput,
  renderTzInput,
} from "./render-field-scalar-inputs.tsx";
import { renderFallbackInput } from "./render-field-text-inputs.tsx";

// A Map, not an object: `field.type` is data, and a bare object lookup would
// resolve inherited keys like "constructor".
const INPUT_RENDERERS: ReadonlyMap<string, InputRenderer> = new Map<string, InputRenderer>([
  ["number", renderNumberInput],
  ["bigInt", renderNumberInput],
  ["decimal", renderDecimalInput],
  ["tz", renderTzInput],
  ["multiSelect", renderMultiSelectInput],
  ["money", renderMoneyInput],
  ["boolean", renderBooleanInput],
  ["date", renderDateInput],
  ["timestamp", renderTimestampInput],
  ["locatedTimestamp", renderLocatedTimestampInput],
  ["select", renderSelectInput],
  ["file", renderFileInput],
  ["image", renderFileInput],
  ["files", renderFileListInput],
  ["images", renderFileListInput],
  ["embedded", renderUnsupportedInput],
  ["jsonb", renderUnsupportedInput],
]);

// Dispatches field.type → Input-kind. Select threads options through
// from the EditFieldViewModel (computeEditViewModel pulls them from
// SelectFieldDef.options). Structural types without a widget (embedded,
// jsonb, multiSelect) render read-only instead of a data-destroying text
// fallback; truly unknown scalar types still fall back to text.
export function renderInput(args: RenderInputArgs): ReactNode {
  const render = INPUT_RENDERERS.get(args.field.type) ?? renderFallbackInput;
  return render(args, sharedInputProps(args));
}
