import { TENANT_CURRENCY_CONFIG_KEY } from "@cosmicdrift/kumiko-types/fields";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { useMemo } from "react";
import { rendererWarn } from "../dev-console.ts";
import type { FormValues } from "../headless/index.ts";
import { type UseQueryResult, useQuery } from "../hooks/use-query.ts";

// `defaultCurrency` is entityEdit-only — it enables the `{amount, currency}`
// write shape (fw#1923); config-edit's plain-number contract needs bare `0`.
// `moneyCurrencyOverrides` (fw#2933) replaces `defaultCurrency` per field name
// — used for a `money` field that declares `currency: { kind: "tenant" }`, so
// its empty initial value carries the tenant's own currency instead of the
// entity-wide default.
export function versionOf(record: Readonly<Record<string, unknown>>): number {
  const version = record["version"];
  return typeof version === "number" ? version : 1;
}

export function buildInitialValues(
  fields: Readonly<Record<string, unknown>>,
  defaultCurrency?: string,
  moneyCurrencyOverrides?: Readonly<Record<string, string>>,
): FormValues {
  const out: FormValues = {};
  for (const [name, def] of Object.entries(fields)) {
    const type = propertyOf(def, "type");
    const defaultValue = propertyOf(def, "default");
    if (defaultValue !== undefined) {
      out[name] = defaultValue;
      continue;
    }
    // An untouched optional number must not persist as a deliberate 0.
    if (type === "number" && propertyOf(def, "required") !== true) {
      out[name] = undefined;
      continue;
    }
    if (type === "embedded" && propertyOf(def, "multiple") === true) {
      out[name] = [];
      continue;
    }
    if (type === "money") {
      const currency = moneyCurrencyOverrides?.[name] ?? defaultCurrency;
      if (currency !== undefined) {
        out[name] = { amount: 0, currency };
        continue;
      }
    }
    out[name] =
      type === "boolean"
        ? false
        : type === "number" || type === "money"
          ? 0
          : type === "multiSelect"
            ? []
            : "";
  }
  return out;
}

// A `money` field opts a currently-empty value into the tenant-settings
// bundle's per-tenant currency (fw#2933) via `currency: { kind: "tenant" }`
// on its FieldDefinition. Read structurally — renderer only depends on the
// client-safe FieldDefinition subset, not the concrete MoneyFieldDef/
// MoneyCurrencySource types, same idiom as the other field-shape narrowings
// in this file (PrefillFieldShape etc.).
export function tenantCurrencyMoneyFieldNames(
  fields: Readonly<Record<string, unknown>>,
): readonly string[] {
  const names: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (
      propertyOf(def, "type") === "money" &&
      propertyOf(propertyOf(def, "currency"), "kind") === "tenant"
    ) {
      names.push(name);
    }
  }
  return names;
}

type TenantConfigValuesResponse = Readonly<
  Record<string, { readonly value: string | number | boolean | undefined }>
>;

type TenantCurrencyResolution =
  | { readonly status: "not-needed" }
  | { readonly status: "loading" }
  | { readonly status: "unresolved" }
  | { readonly status: "ready"; readonly currency: string };

// Resolves what a tenant-declared money field's currency should be, from the
// same `config:query:values` query ConfigEditBody already uses. Never falls
// back to "EUR" while the query is genuinely still in flight (fw#2933) — a
// screen with no tenant-declared money field, or a query that errored or
// returned no value for the key, resolves immediately instead of blocking.
function resolveTenantCurrency(
  fieldNames: readonly string[],
  query: UseQueryResult<TenantConfigValuesResponse>,
  fallback: string | undefined,
): TenantCurrencyResolution {
  if (fieldNames.length === 0) return { status: "not-needed" };
  if (query.error) {
    return fallback === undefined
      ? { status: "unresolved" }
      : { status: "ready", currency: fallback };
  }
  if (query.data === null) return { status: "loading" };
  const raw = query.data[TENANT_CURRENCY_CONFIG_KEY]?.value;
  if (typeof raw === "string" && raw !== "") return { status: "ready", currency: raw };
  return fallback === undefined
    ? { status: "unresolved" }
    : { status: "ready", currency: fallback };
}

// A money field naming a fixed ISO code (`currency: { kind: "literal", code }`,
// fw#2839) resolves with no query at all. Read structurally, same idiom as
// tenantCurrencyMoneyFieldNames above.
export function literalCurrencyOverrides(
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, def] of Object.entries(fields)) {
    const currency = propertyOf(def, "currency");
    const code = propertyOf(currency, "code");
    if (
      propertyOf(def, "type") === "money" &&
      propertyOf(currency, "kind") === "literal" &&
      typeof code === "string"
    ) {
      out[name] = code;
    }
  }
  return out;
}

// Per-field currency for the money fields that declare their own source: a
// literal code resolves synchronously (fw#2839), a `{ kind: "tenant" }` field
// needs the tenant-settings config query and makes the caller hold the form
// until it lands (fw#2933) — seeding the fallback meanwhile would render, and
// on a fast click submit, the wrong currency. Callers pass the tenant field
// names themselves because an edit form only needs the fetch for fields the
// record has no stored value for.
export function useMoneyCurrencyOverrides(
  fields: Readonly<Record<string, unknown>>,
  tenantFieldNames: readonly string[],
  // `undefined` = no safe last resort (entity-less forms): an unresolvable
  // tenant currency is reported via `unresolved` instead of guessing a code.
  fallback: string | undefined,
): {
  readonly overrides: Readonly<Record<string, string>> | undefined;
  readonly loading: boolean;
  readonly unresolved: boolean;
} {
  const query = useQuery<TenantConfigValuesResponse>(
    "config:query:values",
    { keys: [TENANT_CURRENCY_CONFIG_KEY] },
    { enabled: tenantFieldNames.length > 0 },
  );
  const resolution = resolveTenantCurrency(tenantFieldNames, query, fallback);
  const resolvedTenantCurrency = resolution.status === "ready" ? resolution.currency : undefined;
  const overrides = useMemo(() => {
    const out: Record<string, string> = { ...literalCurrencyOverrides(fields) };
    if (resolvedTenantCurrency !== undefined) {
      for (const name of tenantFieldNames) out[name] = resolvedTenantCurrency;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [fields, tenantFieldNames, resolvedTenantCurrency]);
  return {
    overrides,
    loading: resolution.status === "loading",
    unresolved: resolution.status === "unresolved",
  };
}

function multiSelectOptionValues(shape: {
  readonly options?: readonly (string | { readonly value: string })[];
}): ReadonlySet<string> | undefined {
  if (shape.options === undefined || shape.options.length === 0) return undefined;
  return new Set(shape.options.map((o) => (typeof o === "string" ? o : o.value)));
}

type MoneyValue = { readonly amount: number; readonly currency: string };

// The currency now comes from a user-controlled URL param and reaches
// `Intl.NumberFormat`, which throws a RangeError on a malformed code — reject
// it here instead of crashing the form render.
const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/;

export function isMoneyValue(value: unknown): value is MoneyValue {
  if (typeof value !== "object" || value === null) return false;
  const amount = propertyOf(value, "amount");
  const currency = propertyOf(value, "currency");
  return (
    typeof amount === "number" &&
    Number.isFinite(amount) &&
    typeof currency === "string" &&
    CURRENCY_CODE_PATTERN.test(currency)
  );
}

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseJsonOrRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function warnPrefillParam(message: string): void {
  rendererWarn(`[kumiko] ${message}`);
}

// An actionForm has no entity and thus no defaultCurrency, so a bare-number
// prefill would stay a number the handler's zod schema rejects (fw#2763).
function coerceMoneyValue(
  raw: unknown,
  fieldName: string,
  defaultCurrency?: string,
): MoneyValue | number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const value = typeof raw === "string" ? parseJsonOrRaw(raw) : raw;
  if (value === null) return undefined;
  if (isMoneyValue(value)) return { amount: value.amount, currency: value.currency.toUpperCase() };
  if (typeof value === "object") {
    warnPrefillParam(
      `money field "${fieldName}" got an object without a usable {amount, currency} shape — the prefill is ignored.`,
    );
    return undefined;
  }
  if (typeof value === "string" && value.trim() === "") return undefined;
  const amount = Number(typeof value === "number" ? value : raw);
  if (!Number.isFinite(amount)) return undefined;
  if (defaultCurrency !== undefined) return { amount, currency: defaultCurrency };
  warnPrefillParam(
    `money field "${fieldName}" was prefilled with a bare number and no currency is available — pass {"amount":<number>,"currency":"<ISO code>"} as the param value, otherwise the handler's schema rejects the submit.`,
  );
  return amount;
}

type EmbeddedCellShape = {
  readonly type?: string;
  readonly options?: readonly string[];
  readonly scale?: number;
};

// Mirrors isRepresentableAtScale in the framework's schema-builder, which the
// renderer cannot import (server engine). Keep the tolerance identical so a
// prefilled cell never passes here and fails the handler's schema.
function isRepresentableAtScale(value: number, scale: number): boolean {
  const scaled = value * 10 ** scale;
  const tolerance = Math.abs(scaled) * 8 * Number.EPSILON + Number.EPSILON;
  return Math.abs(scaled - Math.round(scaled)) <= tolerance;
}

// Server schema (`z.iso.datetime()`) accepts only a `Z` suffix, while
// Temporal.Instant.from also takes numeric offsets.
function isUtcIsoInstant(value: string): boolean {
  if (!value.endsWith("Z")) return false;
  try {
    Temporal.Instant.from(value);
    return true;
  } catch {
    return false;
  }
}

const EMBEDDED_LIST_PREFILL_ROW_LIMIT = 500;

// The server schema (`z.string().date()`) rejects calendar-invalid days like 2020-02-31.
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}

function isDecimalWithinSafeRange(value: number, scale: number | undefined): boolean {
  return scale === undefined || Math.abs(value) <= Number.MAX_SAFE_INTEGER / 10 ** scale;
}

function coerceEmbeddedCell(value: unknown, cell: EmbeddedCellShape): unknown {
  switch (cell.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    case "decimal":
      return typeof value === "number" &&
        Number.isFinite(value) &&
        (cell.scale === undefined ||
          (isRepresentableAtScale(value, cell.scale) &&
            isDecimalWithinSafeRange(value, cell.scale)))
        ? value
        : undefined;
    case "date":
      return typeof value === "string" && isValidIsoDate(value) ? value : undefined;
    case "timestamp":
      return typeof value === "string" && isUtcIsoInstant(value) ? value : undefined;
    case "money":
      // Row cells are signed minor units; the currency lives on the head, so a
      // top-level `{amount, currency}` in major units would land 100x off.
      return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "select":
      return typeof value === "string" && (cell.options ?? []).includes(value) ? value : undefined;
    default:
      return typeof value === "string" ? value : undefined;
  }
}

// A partially coerced list is the hazard the prefill exists to avoid: the
// handler replaces the list whole, so half a list overwrites the rest.
function coerceEmbeddedListRows(
  raw: string,
  fieldName: string,
  schema: Readonly<Record<string, EmbeddedCellShape>>,
  maxItems?: number,
): readonly Readonly<Record<string, unknown>>[] | undefined {
  const parsed = parseJsonOrRaw(raw);
  if (!Array.isArray(parsed)) {
    warnPrefillParam(
      `embedded-list field "${fieldName}" was prefilled with something that is not a JSON array — the prefill is ignored.`,
    );
    return undefined;
  }
  if (parsed.length > (maxItems ?? EMBEDDED_LIST_PREFILL_ROW_LIMIT)) {
    warnPrefillParam(
      `embedded-list field "${fieldName}" was prefilled with ${parsed.length} rows, more than it accepts — the prefill is ignored.`,
    );
    return undefined;
  }
  const rows: Readonly<Record<string, unknown>>[] = [];
  for (const candidate of parsed) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      warnPrefillParam(
        `embedded-list field "${fieldName}" was prefilled with a row that is not an object — the prefill is ignored.`,
      );
      return undefined;
    }
    const cellEntries: [string, unknown][] = [];
    for (const [cellName, cell] of Object.entries(schema)) {
      const cellValue = propertyOf(candidate, cellName);
      if (cellValue === undefined || cellValue === null) continue;
      const coerced = coerceEmbeddedCell(cellValue, cell);
      if (coerced === undefined) {
        warnPrefillParam(
          `embedded-list field "${fieldName}" was prefilled with a cell "${cellName}" the sub-schema rejects — the prefill is ignored.`,
        );
        return undefined;
      }
      cellEntries.push([cellName, coerced]);
    }
    rows.push(Object.fromEntries(cellEntries));
  }
  return rows;
}

type PrefillFieldShape = {
  readonly type?: string;
  readonly sensitive?: boolean;
  readonly format?: string;
  readonly options?: readonly (string | { readonly value: string })[];
  readonly multiple?: boolean;
  readonly schema?: Readonly<Record<string, EmbeddedCellShape>>;
  readonly maxItems?: number;
};

export type InitialValueSources = {
  readonly searchParams: Readonly<Record<string, string>>;
  // Only these URL query keys may prefill — the target screen's
  // `urlPrefillFields` from buildAppSchema. Absent means none: a crafted link
  // must not seed fields no declared navigate `params` names.
  readonly urlPrefillFields: readonly string[] | undefined;
  readonly renderableFields?: ReadonlySet<string>;
  readonly defaultCurrency?: string;
  // Per-field override of `defaultCurrency` for money fields declaring
  // `currency: { kind: "tenant" }` (fw#2933) — see buildInitialValues.
  readonly moneyCurrencyOverrides?: Readonly<Record<string, string>>;
  // Drawer-kind row actions (fw#2710) prefill from the clicked row's
  // already-typed values; wins over every other source.
  readonly drawerOverrides?: Readonly<Record<string, unknown>>;
  // useNavigateWithInitialValues — in-app only, never in the URL, so it
  // bypasses urlPrefillFields; string values get the URL coercion.
  readonly handoffValues?: Readonly<Record<string, unknown>>;
};

function coercePrefillString(
  raw: string,
  name: string,
  shape: PrefillFieldShape,
  fallback: unknown,
  defaultCurrency: string | undefined,
  moneyCurrencyOverrides: Readonly<Record<string, string>> | undefined,
): unknown {
  if (shape.type === "number") {
    if (raw.trim() === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (shape.type === "money") {
    const coerced = coerceMoneyValue(raw, name, moneyCurrencyOverrides?.[name] ?? defaultCurrency);
    return coerced === undefined ? fallback : coerced;
  }
  if (shape.type === "boolean") return raw === "true";
  if (shape.type === "multiSelect") {
    // Row-action navigate stringifies arrays via String(arr) → "a,b" (or
    // JSON when the navigate helper JSON.stringifies). Try JSON first
    // (even without a "[" prefix), then comma-split; filter against
    // field.options when present so unknown values never reach the form.
    const optionValues = multiSelectOptionValues(shape);
    const splitComma = (): string[] =>
      raw === ""
        ? []
        : raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    let values: string[];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        values = parsed.map((v) => String(v));
      } else if (typeof parsed === "string") {
        values = [parsed];
      } else {
        values = splitComma();
      }
    } catch {
      values = splitComma();
    }
    return optionValues !== undefined ? values.filter((v) => optionValues.has(v)) : values;
  }
  if (shape.type === "embedded" && shape.multiple === true) {
    return coerceEmbeddedListRows(raw, name, shape.schema ?? {}, shape.maxItems) ?? fallback;
  }
  return raw;
}

export function mergeSearchParamsIntoInitial(
  fields: Readonly<Record<string, unknown>>,
  sources: InitialValueSources,
): Record<string, unknown> {
  const {
    searchParams,
    renderableFields,
    defaultCurrency,
    moneyCurrencyOverrides,
    drawerOverrides,
    handoffValues,
  } = sources;
  const urlPrefillFields = new Set(sources.urlPrefillFields ?? []);
  const defaults = buildInitialValues(fields, defaultCurrency, moneyCurrencyOverrides);
  const merged: Record<string, unknown> = { ...defaults };
  for (const [name, fieldDef] of Object.entries(fields)) {
    if (renderableFields !== undefined && !renderableFields.has(name)) continue;
    const shape = fieldDef as PrefillFieldShape;
    // Neither gate is lifted by an allowlist entry or a handoff.
    if (shape.sensitive === true) continue;
    if (shape.format === "password") continue;
    // An `undefined` override (row-extractor key whose row lacks the field)
    // must not wipe the field default.
    if (
      drawerOverrides !== undefined &&
      Object.hasOwn(drawerOverrides, name) &&
      drawerOverrides[name] !== undefined
    ) {
      merged[name] = drawerOverrides[name];
      continue;
    }
    const handedOff =
      handoffValues !== undefined && Object.hasOwn(handoffValues, name)
        ? handoffValues[name]
        : undefined;
    if (handedOff !== undefined) {
      merged[name] =
        typeof handedOff === "string"
          ? coercePrefillString(
              handedOff,
              name,
              shape,
              defaults[name],
              defaultCurrency,
              moneyCurrencyOverrides,
            )
          : handedOff;
      continue;
    }
    if (!urlPrefillFields.has(name)) continue;
    const raw = searchParams[name];
    if (raw === undefined) continue;
    merged[name] = coercePrefillString(
      raw,
      name,
      shape,
      defaults[name],
      defaultCurrency,
      moneyCurrencyOverrides,
    );
  }
  return merged;
}
