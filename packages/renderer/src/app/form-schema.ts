import type {
  EditFieldSpec,
  EntityDefinition,
  EntityEditScreenDefinition,
  FieldDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  evalFieldCondition,
  findUnavailableSelectOptions,
  NO_WIDGET_FIELD_TYPES,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { type EditFormMode, I18N_KEY_PARAM } from "@cosmicdrift/kumiko-headless";
import * as z from "zod";
import { layoutEditFields } from "./layout-fields.js";

// `required` means "has a value", not "is truthy" — `false` and `0` count
// as present, only the actually-empty representations don't.
export function isPresent(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function isEmbeddedListField(field: FieldDefinition): boolean {
  return field.type === "embedded" && field.multiple === true;
}

// Renders raw to the user without a de+en default in i18n-defaults.ts.
export const REQUIRED_FIELD_I18N_KEY = "kumiko.validation.required";
export const OPTION_NOT_AVAILABLE_I18N_KEY = "kumiko.validation.optionNotAvailable";

function isRequiredValueMissing(
  spec: Exclude<EditFieldSpec, string>,
  field: FieldDefinition,
  record: Record<string, unknown>,
  unchangedFrom: Readonly<Record<string, unknown>> | undefined,
): boolean {
  // Screen-spec `required` overrides the entity default, mirroring
  // `view-model/edit.ts` — the rendered form is the reference, and a
  // presence check stricter than the form blocks the user for nothing.
  const entityRequired = "required" in field && field.required === true;
  const isRequired =
    spec.required === undefined ? entityRequired : evalFieldCondition(spec.required, record);
  if (!isRequired) return false;
  // Embedded LIST fields get their own EmbeddedListField grid widget
  // (#1838) — they're fillable, so NO_WIDGET_FIELD_TYPES's "embedded"
  // entry must not exempt them. A statically-`required: true` field
  // with no bound widget is also caught at boot
  // (validateNoWidgetRequiredField in boot-validator/screens.ts).
  if (NO_WIDGET_FIELD_TYPES.includes(field.type) && !isEmbeddedListField(field)) return false;
  if (isPresent(record[spec.field])) return false;
  return !(
    unchangedFrom !== undefined &&
    JSON.stringify(record[spec.field]) === JSON.stringify(unchangedFrom[spec.field])
  );
}

// Client-side presence validation for the auto-wired entityEdit path —
// checks that every rendered required field HAS a value, not that the
// value has the right shape. Format/range/type validation stays server-
// authoritative (buildInsertSchema/buildUpdateSchema): the form-state
// representation of a value can diverge from the server-payload shape (e.g.
// money is `{amount,currency}`, not a bare number), so a format check here
// would either reject valid values or need per-representation branches that
// rot the moment either side changes.
//
// One `superRefine` instead of a per-field shape: a field-level `.refine()`
// wouldn't run at all for a key that's simply absent from `values` —
// `superRefine` sees the whole object and catches that case too.
// `.passthrough()` is load-bearing: the default `z.object({})` STRIPS every
// key (there's no declared shape), so `superRefine` would see an empty
// object regardless of what was actually submitted — every required field
// would misreport as missing.
//
// Iterates the screen's layout field specs, not `entity.fields` — `required`
// and `readOnly` are per-spec, evaluated against the current values the
// same way `view-model/edit.ts` resolves them for the rendered form. Not
// checked here: `visible`. `runValidate` already filters issues on hidden
// fields via `computeFieldStates(options.fields, …)` (form-controller.ts:163,181),
// fed by `deriveFormFields(screen)` in render-edit.tsx.
//
// `verb` selects which `writeExcludedFields` list is skipped.
//
// `unchangedFrom` is for payloadMode "changes" (update): a field still equal to
// its loaded value never reaches the payload, so the server never presence-
// checks it — a legacy row with a now-required empty field must stay saveable
// when the user edits something else.
export function buildFormSchema(
  entity: EntityDefinition,
  screen: EntityEditScreenDefinition,
  verb: EditFormMode,
  unchangedFrom?: Readonly<Record<string, unknown>>,
): z.ZodType {
  const fields = layoutEditFields(screen);
  const excludedFromWrite = new Set(screen.writeExcludedFields?.[verb] ?? []);
  return z
    .object({})
    .passthrough()
    .superRefine((values, ctx) => {
      // `.passthrough()` types `values` as a plain object but doesn't declare
      // its keys — the runtime object always carries every form field.
      // @cast-boundary form-values
      const record = values as Record<string, unknown>;
      const selectFieldsToCheck: Record<string, FieldDefinition> = {};
      for (const spec of fields) {
        const field = entity.fields[spec.field];
        if (!field) continue;
        // Hidden on create, read-only on update: the user cannot resolve a presence error.
        if (excludedFromWrite.has(spec.field)) continue;
        // Not operable by the user — a presence error would be unresolvable,
        // same reason as the NO_WIDGET_FIELD_TYPES check below.
        if (spec.readOnly !== undefined && evalFieldCondition(spec.readOnly, record)) continue;
        selectFieldsToCheck[spec.field] = field;
        if (!isRequiredValueMissing(spec, field, record, unchangedFrom)) continue;
        ctx.addIssue({
          code: "custom",
          path: [spec.field],
          message: `"${spec.field}" is required.`,
          // I18N_KEY_PARAM override, see packages/headless/src/form/zod-bridge.ts.
          params: { [I18N_KEY_PARAM]: REQUIRED_FIELD_I18N_KEY },
        });
      }
      // Against `unchangedFrom` the helper still checks a stored value whose
      // discriminator changed — the server validates the merged row.
      for (const issue of findUnavailableSelectOptions(
        selectFieldsToCheck,
        record,
        unchangedFrom,
      )) {
        ctx.addIssue({
          code: "custom",
          path: [issue.field],
          message: `"${issue.field}" is not available for the current selection.`,
          params: { [I18N_KEY_PARAM]: OPTION_NOT_AVAILABLE_I18N_KEY, allowed: issue.allowed },
        });
      }
    });
}
