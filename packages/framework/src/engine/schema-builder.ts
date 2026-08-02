import { z } from "zod";
import { isValidIanaTimeZone } from "../time";
import { assertUnreachable } from "../utils";
import type { EmbeddedSubFieldDef, EntityDefinition, FieldDefinition } from "./types";
import { DEFAULT_CURRENCIES } from "./types";

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

// Lexikografischer ISO-Vergleich — exakt für `yyyy-mm-dd` (date) und korrekt
// für ISO-Datetime in konsistenter Repräsentation (gleiche Offset-/Präzisions-
// Form). Bewusst ohne Date-API (no-date-api-Guard); die Tag-genaue Grenze
// reicht für min/max-Use-Cases (z.B. Geburtsdatum nicht in der Zukunft).
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
    default:
      assertUnreachable(subField.type, "embedded sub-field type");
  }
}

export function fieldToZod(
  field: FieldDefinition,
  currencies: readonly string[],
  opts: { readonly applyDefaults?: boolean } = {},
): z.ZodTypeAny {
  // Insert callers want `.default(...)` applied so an omitted field falls
  // back to it; buildUpdateSchema passes applyDefaults: false so an omitted
  // field on update stays omitted (a `{ title }` patch must not clobber
  // other columns with their defaults) while a field's own default value is
  // still known here for "" → default mapping (select case below).
  const applyDefaults = opts.applyDefaults ?? true;
  switch (field.type) {
    case "text": {
      let schema = z.string();
      if (field.maxLength) schema = schema.max(field.maxLength);
      if (field.format === "email") schema = schema.email();
      if (field.format === "url") schema = schema.url();
      if (field.required) schema = schema.min(1);
      return field.default !== undefined && applyDefaults ? schema.default(field.default) : schema;
    }
    case "longText": {
      // longText hat keine `format`-Variante (per type-design). Nur
      // optional maxLength + required, sonst ein offener z.string().
      let schema = z.string();
      if (field.maxLength) schema = schema.max(field.maxLength);
      if (field.required) schema = schema.min(1);
      return field.default !== undefined && applyDefaults ? schema.default(field.default) : schema;
    }
    case "boolean": {
      const schema = z.boolean();
      return field.default !== undefined && applyDefaults ? schema.default(field.default) : schema;
    }
    case "select": {
      const [first, ...rest] = field.options;
      if (!first) return z.string();
      const enumSchema = z.enum([first, ...rest]);
      if (field.default !== undefined) {
        // Untouched <select> sends "" too; with a default that maps to the
        // default (same semantics as undefined) instead of the invalid-value
        // rejection from #1702. A field with a default is never "unset" —
        // true on both insert AND update, so this branch (and its "" → default
        // mapping) fires regardless of applyDefaults; only the `.default(...)`
        // schema-level fallback for OMITTED input is update-gated below.
        // `null` maps the same way: the no-default branch below normalizes
        // an untouched select to null, and a client that reuses that value
        // against a since-defaulted field must not get rejected either.
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
    case "multiSelect": {
      const [first, ...rest] = field.options;
      if (!first) return z.array(z.string());
      // `required: true` heißt non-empty — Analogie zu `text`-Field.
      // Leeres Array wird rejected; das globale `.optional()`-Wrapping
      // in buildInsertSchema kümmert sich um „darf fehlen".
      let schema = z.array(z.enum([first, ...rest]));
      if (field.required) schema = schema.min(1);
      return field.default !== undefined && applyDefaults
        ? schema.default([...field.default])
        : schema;
    }
    case "number": {
      let schema = z.number();
      // `integer: true` maps to a Postgres int4 column (entity-table-meta.ts)
      // — bound it here so an out-of-range write fails loud (400) at the
      // schema boundary instead of dying in Postgres (22003 → 500).
      if (field.integer) schema = schema.int().min(-2147483648).max(2147483647);
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return field.default !== undefined && applyDefaults ? schema.default(field.default) : schema;
    }
    case "decimal": {
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
    case "bigInt": {
      // JS-`number`-Round-trip via mode:"number"; sicher bis 2^53.
      // safe-integer-Cap ist explizit damit ein Caller, der einen
      // Float reinwirft (z.B. parseFloat-Bug), beim Insert sofort
      // failed statt silent-Truncation zu kassieren.
      const schema = z.number().int().safe();
      return field.default !== undefined && applyDefaults ? schema.default(field.default) : schema;
    }
    case "money": {
      const [first, ...rest] = currencies;
      if (!first) throw new Error("No currencies configured");
      return z.object({
        amount: z.number(),
        currency: z.enum([first, ...rest]),
      });
    }
    case "embedded": {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [subName, subField] of Object.entries(field.schema)) {
        const zodSub = embeddedSubFieldToZod(subField);
        shape[subName] = subField.required ? zodSub : zodSub.optional();
      }
      const row = z.object(shape);
      if (field.multiple !== true) return row;
      // `required: true` means non-empty, same reading as multiSelect —
      // whether the key may be omitted at all is decided by buildInsertSchema
      // off the same flag.
      const list = z.array(row);
      return field.required === true ? list.min(1) : list;
    }
    case "jsonb": {
      // Free-form jsonb — keys sind tenant-/runtime-defined. Validation
      // passthrough: any plain object passt durch.
      return z.record(z.string(), z.unknown());
    }
    case "date": {
      const schema = z.string().date();
      return withDateBounds(schema, field.min, field.max);
    }
    case "timestamp": {
      // Wenn locatedBy gesetzt: Wall-Clock OHNE Offset (ISO-Datetime ohne `Z`).
      // Sonst: ISO-UTC-Datetime (mit `Z`). Beide werden über z.iso.datetime
      // gegen das ISO-8601-Schema validiert; die Präzision (mit/ohne Offset)
      // hängt von locatedBy ab.
      const schema =
        field.locatedBy !== undefined ? z.iso.datetime({ local: true }) : z.iso.datetime();
      return withDateBounds(schema, field.min, field.max);
    }
    case "tz": {
      // IANA-Zonenname, validiert gegen die Runtime-Zonenliste
      // (isValidIanaTimeZone). Ein ungültiger Name failt hier am
      // Write-Boundary statt erst später in ctx.tz.parse / Temporal.
      return z.string().refine(isValidIanaTimeZone, { message: "invalid IANA time zone" });
    }
    case "locatedTimestamp": {
      // Combined Wall-Clock+TZ Object. Beim Write akzeptieren wir entweder
      // { at, tz } (typisch UI-Form, utc wird berechnet) oder { utc, tz }
      // (typisch Server-zu-Server, at wird berechnet). Beim Read liefert
      // der Read-Wrapper alle drei Felder (siehe Phase D in MIGRATION.md).
      //
      // Hier nur die Schema-Garantie: mindestens tz + (at ODER utc).
      const at = z.iso.datetime({ local: true });
      const tz = z.string().refine(isValidIanaTimeZone, { message: "invalid IANA time zone" });
      const utc = z.iso.datetime();
      return z.union([
        z.object({ at, tz, utc: utc.optional() }),
        z.object({ utc, tz, at: at.optional() }),
      ]);
    }
    case "file":
    case "image": {
      // Single file: stores a fileRef UUID — must match fileRefsTable.id
      // (uuid column). Pre-fix this was z.number() from an era when the
      // column was (wrongly) integer; the table-builder fix to uuid needs
      // a matching validation-layer fix here or the CRUD pipeline rejects
      // every valid UUID with "expected number".
      return z.uuid();
    }
    case "files":
    case "images": {
      // Multi file: array of fileRef UUIDs. Same story as the singular
      // variant — the element type has to match the UUID column on
      // fileRefsTable.id.
      return z.array(z.uuid());
    }
    case "reference":
      // Tier 2.7e-3: Validiert UUID-shape. Existenz-Check der Reference
      // (Row im referenced Table existiert + Tenant-Scope) ist Server-
      // side-Verantwortung im Handler / Foreign-Key-Constraint, nicht
      // im Schema-Validator (würde sonst Round-trip zur DB beim Parse).
      // Multi-Mode (Tier 2.7e-Multi): Array von UUIDs.
      return field.multiple === true ? z.array(z.uuid()) : z.uuid();
    default:
      assertUnreachable(field, "field type");
  }
}

export function buildInsertSchema(
  entity: EntityDefinition,
  currencies: readonly string[] = [...DEFAULT_CURRENCIES],
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, field] of Object.entries(entity.fields)) {
    const zodField = fieldToZod(field, currencies);
    const hasDefault = "default" in field && field.default !== undefined;
    const isRequired = "required" in field && field.required === true;
    shape[name] = isRequired || hasDefault ? zodField : zodField.optional();
  }

  return z.object(shape);
}

export function buildUpdateSchema(
  entity: EntityDefinition,
  currencies: readonly string[] = [...DEFAULT_CURRENCIES],
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, field] of Object.entries(entity.fields)) {
    // Update schemas never apply defaults for OMITTED fields — a user that
    // sends only `{ title }` means "only change title"; zod defaults would
    // silently inject default values for every omitted field and clobber
    // existing data via the event-store-executor's `changes` payload.
    // The field is passed through un-stripped (unlike before fw#1703) so
    // fieldToZod still knows the default for its "" → default mapping
    // (e.g. select) — applyDefaults: false only suppresses the schema-level
    // `.default(...)` fallback for a genuinely omitted key.
    shape[name] = fieldToZod(field, currencies, { applyDefaults: false }).optional();
  }

  return z.object(shape);
}
