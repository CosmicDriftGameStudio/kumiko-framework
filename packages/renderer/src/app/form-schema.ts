import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { evalFieldCondition } from "@cosmicdrift/kumiko-framework/ui-types";
import { z } from "zod";
import { layoutEditFields } from "./layout-fields";

// `required` means "has a value", not "is truthy" — `false` and `0` count
// as present, only the actually-empty representations don't.
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

// Field types without a bound, editable widget on the auto-wired
// entityEdit path (render-field.tsx renders a read-only banner instead) —
// a presence error on one of them would be unresolvable by the user.
// Tracked in #1925 (field types without an operable widget).
const FIELD_TYPES_WITHOUT_WIDGET = new Set(["multiSelect", "jsonb", "embedded"]);

// Client-side presence validation for the auto-wired entityEdit path —
// checks that every rendered required field HAS a value, not that the
// value has the right shape. Format/range/type validation stays server-
// authoritative (buildInsertSchema/buildUpdateSchema): the form-state
// representation of a value (e.g. money as a bare `number` on create vs.
// `{amount,currency}` on update, #1923: money doesn't round-trip) diverges
// from the server-payload shape, so a format check here would either
// reject valid values or need per-representation branches that rot the
// moment either side changes.
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
export function buildFormSchema(
  entity: EntityDefinition,
  screen: EntityEditScreenDefinition,
): z.ZodType {
  const fields = layoutEditFields(screen);
  return z
    .object({})
    .passthrough()
    .superRefine((values, ctx) => {
      // `.passthrough()` types `values` as a plain object but doesn't declare
      // its keys — the runtime object always carries every form field.
      // @cast-boundary form-values
      const record = values as Record<string, unknown>;
      for (const spec of fields) {
        const field = entity.fields[spec.field];
        if (!field) continue;
        // Not operable by the user — a presence error would be unresolvable,
        // same reason as the FIELD_TYPES_WITHOUT_WIDGET check below.
        if (spec.readOnly !== undefined && evalFieldCondition(spec.readOnly, record)) continue;
        // Screen-spec `required` overrides the entity default, mirroring
        // `view-model/edit.ts` — the rendered form is the reference, and a
        // presence check stricter than the form blocks the user for nothing.
        const entityRequired = "required" in field && field.required === true;
        const isRequired =
          spec.required === undefined ? entityRequired : evalFieldCondition(spec.required, record);
        if (!isRequired) continue;
        if (FIELD_TYPES_WITHOUT_WIDGET.has(field.type)) continue;
        if (isPresent(record[spec.field])) continue;
        ctx.addIssue({
          code: "custom",
          path: [spec.field],
          message: `"${spec.field}" is required.`,
        });
      }
    });
}
