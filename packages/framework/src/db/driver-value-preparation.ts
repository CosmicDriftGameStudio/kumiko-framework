import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isPiiCiphertext } from "../crypto/pii-ciphertext-format.ts";
import { SQL_EXPR_BRAND } from "./dialect.ts";
import {
  isTemporalInstant,
  isTemporalPlainDate,
  isTemporalPlainDateTimeLike,
} from "./temporal-value-guards.ts";

// Helper for jsonb values: structured values bind as a JS object/array with
// an ::jsonb cast. JSON.stringify before the cast would produce JSON-string scalars.
// Plus Temporal.Instant → ISO string coercion for timestamptz columns.
// SqlExpression (sql`now()`, sql`gen_random_uuid()`) is returned as
// kind:"literal" — the caller embeds it inline instead of setting a $N placeholder.
export type PreparedValue =
  | { readonly kind: "param"; readonly sql: string; readonly bound: unknown }
  | { readonly kind: "literal"; readonly literal: string };

// Checks the brand Symbol, not the `kind` string — a client-supplied jsonb
// value can fake `kind: "sql-expr"` over JSON but can never carry a Symbol,
// so request data can't be smuggled in as a raw SQL literal.
export function isSqlExpression(v: unknown): v is { kind: "sql-expr"; text: string } {
  return typeof v === "object" && v !== null && SQL_EXPR_BRAND in v;
}

// A `date` column takes a plain "yyyy-mm-dd" string (or PlainDate.toString())
// as-is — no Instant detour. Postgres parses a DATE literal without ever
// consulting the session timezone, so this is TZ-independent by construction
// (verified empirically — see plainDateFromDriver above for the read side).
// Compat cushion: code (this field used to be an Instant) may still
// hand a Temporal.Instant into a where-filter or write on a `date` column —
// same UTC anchor as plainDateFromDriver's read side, so a filter built with
// `Temporal.Now.instant()` keeps working instead of binding a raw Instant the
// driver can't serialize.
function prepareDateValue(value: unknown): PreparedValue | undefined {
  if (isTemporalPlainDate(value)) {
    return { kind: "param", sql: "", bound: value.toString() };
  }
  if (isTemporalPlainDateTimeLike(value)) {
    return { kind: "param", sql: "", bound: value.toPlainDate().toString() };
  }
  if (isTemporalInstant(value)) {
    const day = value.toZonedDateTimeISO("UTC").toPlainDate();
    return { kind: "param", sql: "", bound: day.toString() };
  }
  return undefined;
}

// structured values bind directly with an ::jsonb cast; JSON.stringify first
// would produce a JSON-string scalar instead of the structured value.
export function prepareJsonbValue(value: unknown): PreparedValue | undefined {
  // Bun.SQL types JS numbers as int4/float8 params, which Postgres refuses for a jsonb column.
  // Non-finite numbers fall through so Postgres rejects them instead of storing JSON null.
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    return { kind: "param", sql: "::text::jsonb", bound: JSON.stringify(value) };
  }
  if (typeof value !== "object" || isTemporalInstant(value)) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return { kind: "param", sql: "::jsonb", bound: value };
  }
  // All-boolean arrays are inferred as boolean[] by the driver; route via text::jsonb.
  if (value.length > 0 && value.every((entry) => typeof entry === "boolean")) {
    return { kind: "param", sql: "::text::jsonb", bound: JSON.stringify(value) };
  }
  return { kind: "param", sql: "::jsonb", bound: value };
}

const INTEGER_PG_TYPES: ReadonlySet<string> = new Set([
  "integer",
  "int4",
  "smallint",
  "int2",
  "bigint",
  "int8",
  "serial",
  "bigserial",
]);

// Postgres rounds sub-millisecond params into timestamptz(3); truncating to ms here keeps the
// stored instant identical across drivers and equal to what a Date param would store.
export function instantToTimestamptzParam(instant: Temporal.Instant): string {
  return Temporal.Instant.fromEpochMilliseconds(instant.epochMilliseconds).toString();
}

function prepareDriverNeutralScalar(
  value: unknown,
  pgType: string | undefined,
): PreparedValue | undefined {
  if ((pgType === "timestamptz" || pgType === "timestamptz(3)") && isTemporalInstant(value)) {
    return { kind: "param", sql: "", bound: instantToTimestamptzParam(value) };
  }
  // Sent as text, so Postgres rejects 3.5 for an integer column instead of rounding it.
  if (typeof value === "number" && pgType !== undefined && INTEGER_PG_TYPES.has(pgType)) {
    return { kind: "param", sql: "", bound: String(value) };
  }
  return undefined;
}

export function prepareValue(value: unknown, pgType: string | undefined): PreparedValue {
  if (isSqlExpression(value)) {
    return { kind: "literal", literal: value.text };
  }
  // A PII-encrypted jsonb field is a JSON string scalar; a raw string bound to
  // ::jsonb would be parsed as JSON text (or double-encoded).
  if (pgType === "jsonb" && isPiiCiphertext(value)) {
    return { kind: "param", sql: "::text::jsonb", bound: JSON.stringify(value) };
  }
  if (pgType === "jsonb" && value !== null) {
    const prepared = prepareJsonbValue(value);
    if (prepared) return prepared;
  }
  const scalar = prepareDriverNeutralScalar(value, pgType);
  if (scalar) return scalar;
  if (pgType === "date") {
    const prepared = prepareDateValue(value);
    if (prepared) return prepared;
  }
  return { kind: "param", sql: "", bound: value };
}
