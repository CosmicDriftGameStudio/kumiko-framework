import * as z from "zod";
import { moneyPayloadToMinorUnits } from "../db/money.ts";
import { isValidIanaTimeZone } from "../time/index.ts";
import { assertUnreachable } from "../utils/index.ts";
import { withDerivedCells } from "./embedded-derived.ts";
import { isValidIban } from "./iban.ts";
import type { EmbeddedSubFieldDef, EntityDefinition, FieldDefinition } from "./types/index.ts";
import { DEFAULT_CURRENCIES } from "./types/index.ts";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// True if `n` carries at most `scale` decimal places. A relative epsilon
// tolerates float artifacts (`0.1 + 0.2 = 0.30000000000000004` is accepted at
// scale 2) — the exact `toFixed`-roundtrip-equality it replaces rejected such
// computed-but-in-scale values. A genuinely over-scale value (0.305 @ scale 2)
// scales to ~30.5, far from any integer, and is still rejected.
export function isRepresentableAtScale(n: number, scale: number): boolean {
  const scaled = n * 10 ** scale;
  const tolerance = Math.abs(scaled) * 8 * Number.EPSILON + Number.EPSILON;
  return Math.abs(scaled - Math.round(scaled)) <= tolerance;
}

// Lexicographic ISO comparison — exact for `yyyy-mm-dd` (date) and correct
// for ISO datetimes in a consistent representation (same offset/precision
// form). Deliberately avoids the Date API (no-date-api-Guard); day-level
// comparison is sufficient for min/max use cases (e.g. a birth date not in
// the future).
function withDateBounds(
  schema: z.ZodTypeAny,
  min: string | undefined,
  max: string | undefined,
): z.ZodTypeAny {
  if (min === undefined && max === undefined) return schema;
  const message =
    min !== undefined && max !== undefined
      ? `must be between ${min} and ${max}`
      : min !== undefined
        ? `must be on or after ${min}`
        : `must be on or before ${max}`;
  return schema.refine(
    (value: unknown) =>
      typeof value === "string" &&
      (min === undefined || value >= min) &&
      (max === undefined || value <= max),
    { message },
  );
}

function embeddedSubFieldToZod(subField: EmbeddedSubFieldDef): z.ZodTypeAny {
  switch (subField.type) {
    case "text":
      return subField.required ? z.string().min(1) : z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "date":
      return z.string().date();
    case "money":
      // Signed minor units; the currency lives on the head aggregate, not the
      // row. The safe-integer cap mirrors bigInt mode:"number" — jsonb has no
      // BIGINT column behind it, so 2^53 is the real representability boundary.
      return z.number().int().safe();
    case "timestamp":
      // No locatedBy/min/max on EmbeddedSubFieldDef (unlike the top-level
      // timestamp field) — plain UTC-instant ISO-datetime validation.
      return z.iso.datetime();
    case "decimal": {
      // No numeric column behind jsonb, so the bounds come from float
      // representability alone: the value scaled by 10^scale must be a safe
      // integer, i.e. at most `scale` fractional digits within ±2^53.
      const limit = Number.MAX_SAFE_INTEGER / 10 ** subField.scale;
      return z
        .number()
        .gte(-limit)
        .lte(limit)
        .refine((n) => isRepresentableAtScale(n, subField.scale), {
          message: `at most ${subField.scale} decimal places`,
        });
    }
    case "select": {
      const [first, ...rest] = subField.options;
      if (!first) return z.string();
      return z.enum([first, ...rest]);
    }
    case "reference":
      return z.uuid();
    default:
      assertUnreachable(subField, "embedded sub-field type");
  }
}

type FieldOf<K extends FieldDefinition["type"]> = Extract<FieldDefinition, { type: K }>;

type FieldToZodContext = { readonly applyDefaults: boolean; readonly isUpdate: boolean };

function textFieldToZod(field: FieldOf<"text">, { applyDefaults, isUpdate }: FieldToZodContext) {
  let schema = z.string();
  if (field.maxLength) schema = schema.max(field.maxLength);
  if (field.minLength) {
    // "" must stay valid for optional fields and writeOnly updates (""
    // = unchanged); `required` rejects it separately via min(1) below.
    const minLength = field.minLength;
    schema = schema.refine((value) => value.length === 0 || value.length >= minLength, {
      message: `at least ${minLength} characters`,
    });
  }
  if (field.writeOnly === true) {
    // Update: "" = unchanged (dropped before the executor), null = clear,
    // unless required. Create: "" would leave a required field unset.
    if (!isUpdate) return field.required ? schema.min(1) : schema;
    return field.required ? schema : schema.nullable();
  }
  if (field.format === "email") schema = schema.email();
  if (field.format === "url") schema = schema.url();
  if (field.format === "iban") {
    // "" stays valid for an optional field; `required` rejects it via min(1) below.
    schema = schema.superRefine((value, ctx) => {
      if (value !== "" && !isValidIban(value)) {
        ctx.addIssue({ code: "invalid_format", format: "iban", input: value });
      }
    });
  }
  if (field.format === "month") {
    // "" stays valid for an optional field; `required` rejects it via min(1) below.
    schema = schema.refine((value) => value === "" || MONTH_PATTERN.test(value), {
      message: "expected a month as YYYY-MM",
    });
  }
  if (field.required) schema = schema.min(1);
  return field.default !== undefined && applyDefaults ? schema.default(field.default) : schema;
}

function longTextFieldToZod(field: FieldOf<"longText">, applyDefaults: boolean): z.ZodTypeAny {
  // longText has no `format` variant (by type design). Only optional
  // maxLength and required are supported; otherwise it is an unrestricted
  // z.string().
  let schema = z.string();
  if (field.maxLength) schema = schema.max(field.maxLength);
  if (field.required) schema = schema.min(1);
  return field.default !== undefined && applyDefaults ? schema.default(field.default) : schema;
}

function selectFieldToZod(field: FieldOf<"select">, applyDefaults: boolean): z.ZodTypeAny {
  const [first, ...rest] = field.options;
  if (!first) return z.string();
  const enumSchema = z.enum([first, ...rest]);
  if (field.default !== undefined) {
    // Untouched <select> sends "" too; with a default that maps to the
    // default (same semantics as undefined) instead of the invalid-value
    // rejection. A field with a default is never "unset" —
    // true on both insert AND update, so this branch (and its "" → default
    // mapping) fires regardless of applyDefaults; only the `.default(...)`
    // schema-level fallback for OMITTED input is update-gated below.
    // `null` maps the same way: the no-default branch below normalizes
    // an untouched select to null, and a client that reuses that value
    // against a defaulted field must not get rejected either.
    const mapped = z.preprocess(
      (value) => (value === "" || value === null ? field.default : value),
      enumSchema,
    );
    return applyDefaults ? mapped.default(field.default) : mapped;
  }
  if (field.required) return enumSchema;
  // Optional select without a default: an untouched HTML <select> submits
  // "" for its placeholder option. Treat that as "unset" (null) instead of
  // an invalid enum value — null (not undefined) so the value survives the
  // JSON-serialized event payload and an update can actually clear a
  // previously-set select back to unset, not just skip validation.
  return z.preprocess((value) => (value === "" ? null : value), enumSchema.nullable());
}

function multiSelectFieldToZod(
  field: FieldOf<"multiSelect">,
  applyDefaults: boolean,
): z.ZodTypeAny {
  const [first, ...rest] = field.options;
  if (!first) return z.array(z.string());
  // `required: true` means non-empty, as with a `text` field.
  // An empty array is rejected; the global `.optional()` wrapping
  // in buildInsertSchema determines whether the field may be omitted.
  let schema = z.array(z.enum([first, ...rest]));
  if (field.required) schema = schema.min(1);
  return field.default !== undefined && applyDefaults ? schema.default([...field.default]) : schema;
}

function numberFieldToZod(field: FieldOf<"number">, applyDefaults: boolean): z.ZodTypeAny {
  let schema = z.number();
  // `integer: true` maps to a Postgres int4 column (entity-table-meta.ts)
  // — bound it here so an out-of-range write fails loud (400) at the
  // schema boundary instead of dying in Postgres (22003 → 500).
  if (field.integer) schema = schema.int().min(-2147483648).max(2147483647);
  if (field.min !== undefined) schema = schema.min(field.min);
  if (field.max !== undefined) schema = schema.max(field.max);
  return field.default !== undefined && applyDefaults ? schema.default(field.default) : schema;
}

function decimalFieldToZod(field: FieldOf<"decimal">, applyDefaults: boolean): z.ZodTypeAny {
  // Stored as numeric(precision, scale), surfaced as JS number. Bound the
  // value at the write boundary so an over-range or over-scale input fails
  // loud here instead of being silently rounded/rejected by Postgres.
  const limit = 10 ** (field.precision - field.scale);
  const schema = z
    .number()
    .gt(-limit)
    .lt(limit)
    .refine((n) => isRepresentableAtScale(n, field.scale), {
      message: `at most ${field.scale} decimal places`,
    });
  return field.default !== undefined && applyDefaults ? schema.default(field.default) : schema;
}

function moneyFieldToZod(currencies: readonly string[]): z.ZodTypeAny {
  const [first, ...rest] = currencies;
  if (!first) throw new Error("No currencies configured");
  return z.object({
    amount: z.number(),
    currency: z.enum([first, ...rest]),
  });
}

function embeddedFieldToZod(field: FieldOf<"embedded">): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [subName, subField] of Object.entries(field.schema)) {
    const zodSub = embeddedSubFieldToZod(subField);
    shape[subName] = subField.required ? zodSub : zodSub.optional();
  }
  const baseRow = z.object(shape);
  const derived = field.derived;
  // The server is the authority for derived cells: a row is recomputed
  // here, overwriting whatever the client sent, instead of merely
  // being checked against it.
  const row =
    derived === undefined
      ? baseRow
      : z.preprocess((value) => withDerivedCells(value, derived, field.schema), baseRow);
  if (field.multiple !== true) return row;
  // `required: true` means non-empty, same reading as multiSelect —
  // whether the key may be omitted at all is decided by buildInsertSchema
  // off the same flag. `minItems` overrides that default when set.
  let list = z.array(row);
  if (field.maxItems !== undefined) list = list.max(field.maxItems);
  const min = field.minItems ?? (field.required === true ? 1 : undefined);
  if (min === undefined) return list;
  // A custom issue rather than min(): other arrays (multiSelect) share zod's
  // too_small and must not read "rows"; the bridge honours params.i18nKey.
  return list.superRefine((rows, ctx) => {
    // skip: the minimum is met, nothing to report
    if (rows.length >= min) return;
    ctx.addIssue({
      code: "custom",
      input: rows,
      params: {
        i18nKey: `errors.validation.list_min_rows.${min === 1 ? "one" : "other"}`,
        minimum: min,
      },
    });
  });
}

function timestampFieldToZod(field: FieldOf<"timestamp">): z.ZodTypeAny {
  // When locatedBy is set: wall-clock time without an offset (ISO datetime
  // without `Z`). Otherwise: ISO UTC datetime (with `Z`). Both are validated
  // against the ISO-8601 schema through z.iso.datetime; precision (with or
  // without an offset) depends on locatedBy.
  const schema = field.locatedBy !== undefined ? z.iso.datetime({ local: true }) : z.iso.datetime();
  return withDateBounds(schema, field.min, field.max);
}

function locatedTimestampToZod(): z.ZodTypeAny {
  // Combined wall-clock and time-zone object. On write, either
  // { at, tz } (typical for a UI form, with utc calculated) or { utc, tz }
  // (typical for server-to-server communication, with at calculated) is
  // accepted. On read, the read wrapper provides all three fields.
  //
  // The schema guarantees only tz plus at least one of at or utc.
  const at = z.iso.datetime({ local: true });
  const tz = z.string().refine(isValidIanaTimeZone, { message: "invalid IANA time zone" });
  const utc = z.iso.datetime();
  return z.union([
    z.object({ at, tz, utc: utc.optional() }),
    z.object({ utc, tz, at: at.optional() }),
  ]);
}

function fileListFieldToZod(field: FieldOf<"files" | "images">): z.ZodTypeAny {
  // Multi file: array of fileRef UUIDs. Same story as the singular
  // variant — the element type has to match the UUID column on
  // fileRefsTable.id.
  const ids = z.array(z.uuid());
  return field.maxCount === undefined ? ids : ids.max(field.maxCount);
}

// kumiko-lint-ignore complexity-budget field→zod switch is the single schema source of truth
export function fieldToZod(
  field: FieldDefinition,
  currencies: readonly string[],
  opts: { readonly applyDefaults?: boolean; readonly isUpdate?: boolean } = {},
): z.ZodTypeAny {
  // Insert callers want `.default(...)` applied so an omitted field falls
  // back to it; buildUpdateSchema passes applyDefaults: false so an omitted
  // field on update stays omitted (a `{ title }` patch must not clobber
  // other columns with their defaults) while a field's own default value is
  // still known here for "" → default mapping (selectFieldToZod).
  const applyDefaults = opts.applyDefaults ?? true;
  const ctx: FieldToZodContext = { applyDefaults, isUpdate: opts.isUpdate === true };
  switch (field.type) {
    case "text":
      return textFieldToZod(field, ctx);
    case "longText":
      return longTextFieldToZod(field, applyDefaults);
    case "boolean": {
      const schema = z.boolean();
      return field.default !== undefined && applyDefaults ? schema.default(field.default) : schema;
    }
    case "select":
      return selectFieldToZod(field, applyDefaults);
    case "multiSelect":
      return multiSelectFieldToZod(field, applyDefaults);
    case "number":
      return numberFieldToZod(field, applyDefaults);
    case "decimal":
      return decimalFieldToZod(field, applyDefaults);
    case "bigInt": {
      // JS-`number` round-trip via mode:"number"; exact up to 2^53.
      // The safe-integer cap ensures that a caller passing a float (for example,
      // due to a parseFloat bug) fails immediately at insert instead of being
      // silently truncated.
      const schema = z.number().int().safe();
      return field.default !== undefined && applyDefaults ? schema.default(field.default) : schema;
    }
    case "money":
      return moneyFieldToZod(currencies);
    case "embedded":
      return embeddedFieldToZod(field);
    case "jsonb":
      // Free-form jsonb — keys are tenant-/runtime-defined. Validation
      // passes through any plain object.
      return z.record(z.string(), z.unknown());
    case "date":
      return withDateBounds(z.string().date(), field.min, field.max);
    case "timestamp":
      return timestampFieldToZod(field);
    case "tz":
      // IANA time-zone name, validated against the runtime's zone list
      // (isValidIanaTimeZone). An invalid name fails at the write boundary
      // instead of later in ctx.tz.parse / Temporal.
      return z.string().refine(isValidIanaTimeZone, { message: "invalid IANA time zone" });
    case "locatedTimestamp":
      return locatedTimestampToZod();
    case "file":
    case "image":
      // Single file: stores a fileRef UUID — must match fileRefsTable.id
      // (uuid column). Pre-fix this was z.number() from an era when the
      // column was (wrongly) integer; the table-builder fix to uuid needs
      // a matching validation-layer fix here or the CRUD pipeline rejects
      // every valid UUID with "expected number".
      return z.uuid();
    case "files":
    case "images":
      return fileListFieldToZod(field);
    case "reference":
      // Validates the UUID shape. Checking that the reference exists
      // (the row exists in the referenced table and belongs to the tenant) is
      // the handler / foreign-key constraint's responsibility, not the schema
      // validator's; checking it here would require a database round trip during
      // parsing.
      // Multi-mode accepts an array of UUIDs.
      return field.multiple === true ? z.array(z.uuid()) : z.uuid();
    default:
      assertUnreachable(field, "field type");
  }
}

// Cross-field check for `EmbeddedFieldDef.totalsMatch`: the sum of a list
// subfield across every row must equal a sibling top-level money field.
// Runs via the same z.object().safeParse() call on both the client
// (form-controller's runValidate) and the server (write handler) — one
// mechanism, no separate client/server validation path to keep in sync.
// Row cells have no currency of their own (they're minor units in the
// entity's default currency); a sibling tagged with a different currency
// fails the check even if the raw minor-unit amounts happen to match.
//
// Known limitation: compares against rounded `derived` cells, i.e.
// "sum-of-rounded" not "round-of-sum".
// kumiko-lint-ignore complexity-budget currency-equality check on sibling money payloads
function applyTotalsMatchRefinements(
  entity: EntityDefinition,
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  let result = schema;
  for (const [fieldName, field] of Object.entries(entity.fields)) {
    if (field.type !== "embedded" || field.totalsMatch === undefined) continue;
    const totalsMatch = field.totalsMatch;
    result = result.superRefine((values, ctx) => {
      for (const [subFieldName, siblingFieldName] of Object.entries(totalsMatch)) {
        const rawRows = values[fieldName];
        const siblingRaw = values[siblingFieldName];
        // Neither side sent → nothing to check (unrelated partial update).
        if (rawRows === undefined && siblingRaw === undefined) continue;
        // One side of a totalsMatch pair without the other → reject. Update
        // payloads only carry `changes`, so omitting the sibling would otherwise
        // silently leave sum ≠ total.
        if (rawRows === undefined || siblingRaw === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [rawRows === undefined ? fieldName : siblingFieldName],
            message: `totalsMatch requires both "${fieldName}" and "${siblingFieldName}" in the same payload`,
          });
          continue;
        }
        // Not an array -> a different refinement already rejects the shape;
        // this check isn't the right place to report it.
        if (!Array.isArray(rawRows)) continue;
        const siblingMinor = moneyPayloadToMinorUnits(siblingRaw);
        if (siblingMinor === undefined) continue;
        const siblingCurrency =
          typeof siblingRaw === "object" && siblingRaw !== null && "currency" in siblingRaw
            ? siblingRaw.currency
            : undefined;
        const entityCurrency = entity.defaultCurrency ?? DEFAULT_CURRENCIES[0];
        if (typeof siblingCurrency === "string" && siblingCurrency !== entityCurrency) {
          ctx.addIssue({
            code: "custom",
            path: [siblingFieldName],
            message: `"${siblingFieldName}" currency (${siblingCurrency}) does not match the entity's default currency (${entityCurrency}) that "${fieldName}" rows are summed in`,
          });
          continue;
        }
        const sumMinor = rawRows.reduce((total: number, row: unknown) => {
          const value =
            typeof row === "object" && row !== null ? Reflect.get(row, subFieldName) : undefined;
          return total + (typeof value === "number" ? value : 0);
        }, 0);
        if (sumMinor !== siblingMinor) {
          ctx.addIssue({
            code: "custom",
            path: [fieldName],
            message: `Sum of "${subFieldName}" across "${fieldName}" (${sumMinor}) does not match "${siblingFieldName}" (${siblingMinor})`,
          });
        }
      }
    });
  }
  return result;
}

// An excluded field stays in the shape as "must be absent" instead of being
// dropped: zod strips unknown keys silently, so a client still sending it
// would otherwise get a success without the write happening.
function notWritableField(): z.ZodTypeAny {
  return z.never().optional();
}

export const SYSTEM_ONLY_JSON_SCHEMA_KEY = "x-kumiko-system-only";

export function buildInsertSchema(
  entity: EntityDefinition,
  currencies: readonly string[] = [...DEFAULT_CURRENCIES],
  excludedFields: readonly string[] = [],
  options: { readonly allowCallerId?: boolean } = {},
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, field] of Object.entries(entity.fields)) {
    if (excludedFields.includes(name)) {
      shape[name] = notWritableField();
      continue;
    }
    const zodField = fieldToZod(field, currencies);
    const hasDefault = "default" in field && field.default !== undefined;
    const isRequired = "required" in field && field.required === true;
    shape[name] = isRequired || hasDefault ? zodField : zodField.optional();
  }

  // Opt-in only for the generic create verb, which honors the id for system identities;
  // other schema consumers must keep stripping an unknown `id`.
  if (options.allowCallerId) {
    // Marked so agent-facing exports can drop it: agent dispatch never runs as
    // a system identity, so a caller-chosen id would be silently discarded.
    shape["id"] = z
      .uuid()
      .optional()
      .meta({ [SYSTEM_ONLY_JSON_SCHEMA_KEY]: true });
  }

  return applyTotalsMatchRefinements(entity, z.object(shape));
}

// Field types whose column is nullable and whose projection write accepts a
// plain `null`. Excluded: select/writeOnly text (fieldToZod is already
// nullable there), and types where null would not clear cleanly — NOT NULL
// jsonb columns (multiSelect, embedded, jsonb, multi reference, files/images),
// locatedTimestamp (split into _utc/_tz
// columns, a bare null targets a column that does not exist) and money (the
// currency column would keep its stale value).
const NULL_CLEARABLE_FIELD_TYPES: ReadonlySet<FieldDefinition["type"]> = new Set([
  "text",
  "longText",
  "boolean",
  "number",
  "bigInt",
  "decimal",
  "reference",
  "date",
  "timestamp",
  "tz",
  "file",
  "image",
]);

function isClearableByNull(field: FieldDefinition): boolean {
  if (!NULL_CLEARABLE_FIELD_TYPES.has(field.type)) return false;
  if (field.type === "reference" && field.multiple === true) return false;
  if (field.type === "text" && field.writeOnly === true) return false;
  const isRequired = "required" in field && field.required === true;
  const hasDefault = "default" in field && field.default !== undefined;
  return !isRequired && !hasDefault;
}

export function buildUpdateSchema(
  entity: EntityDefinition,
  currencies: readonly string[] = [...DEFAULT_CURRENCIES],
  excludedFields: readonly string[] = [],
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, field] of Object.entries(entity.fields)) {
    if (excludedFields.includes(name)) {
      shape[name] = notWritableField();
      continue;
    }
    // Update schemas never apply defaults for OMITTED fields — a user that
    // sends only `{ title }` means "only change title"; zod defaults would
    // silently inject default values for every omitted field and clobber
    // existing data via the event-store-executor's `changes` payload.
    // The field is passed through un-stripped so
    // fieldToZod still knows the default for its "" → default mapping
    // (e.g. select) — applyDefaults: false only suppresses the schema-level
    // `.default(...)` fallback for a genuinely omitted key.
    const zodField = fieldToZod(field, currencies, {
      applyDefaults: false,
      isUpdate: true,
    });
    shape[name] = (isClearableByNull(field) ? zodField.nullable() : zodField).optional();
  }

  return applyTotalsMatchRefinements(entity, z.object(shape));
}
