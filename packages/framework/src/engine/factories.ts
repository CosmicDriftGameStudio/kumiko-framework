import type {
  BigIntFieldDef,
  BooleanFieldDef,
  DateFieldDef,
  DecimalFieldDef,
  DerivedFieldDef,
  EmbeddedFieldDef,
  EntityDefinition,
  EntityIndexDef,
  EntityLongTextFieldDef,
  EntityTextFieldDef,
  FieldsMap,
  FileFieldDef,
  FilesFieldDef,
  Findability,
  ImageFieldDef,
  ImagesFieldDef,
  JsonbFieldDef,
  LocatedTimestampFieldDef,
  LongTextFieldDef,
  MoneyFieldDef,
  MultiSelectFieldDef,
  NumberFieldDef,
  PersonalAnnotations,
  PersonalAnnotationsLongText,
  PersonalAnnotationsNoFind,
  PersonalSubject,
  ResolvedPiiFlags,
  RetentionDef,
  SelectFieldDef,
  TimestampFieldDef,
  TzFieldDef,
} from "@cosmicdrift/kumiko-types/fields";
import type { EntityTenancy } from "@cosmicdrift/kumiko-types/tenancy-brand";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { TextFieldDef } from "./types/index.ts";

type PersonalOverridesInput = {
  readonly personal?: PersonalSubject | "ref" | false;
  readonly find?: Findability;
  readonly reason?: string;
  readonly anonymize?: () => unknown | Promise<unknown>;
};

// `personal: { of: "id" }` means the row itself is the subject, not a
// referenced user — resolves to `recordOwned` instead of `userOwned`.
const RECORD_OWNER_FIELD = "id";

function resolvePersonalFlags(
  personal: PersonalOverridesInput["personal"],
  reason: PersonalOverridesInput["reason"],
): ResolvedPiiFlags {
  if (personal === "self") return { pii: true };
  if (personal === "tenant") return { tenantOwned: true };
  if (personal === "ref") return { subjectRef: true };
  if (personal === false) return { allowPlaintext: reason };
  if (!personal) return {};
  if (personal.of === RECORD_OWNER_FIELD) {
    if (personal.whenAbsent !== undefined) {
      throw new Error(
        `personal: { of: "${RECORD_OWNER_FIELD}", whenAbsent } is meaningless: a row always has an id, so there is never an absent owner (fw#3654)`,
      );
    }
    return { recordOwned: true };
  }
  const { whenAbsent } = personal;
  return {
    userOwned: { ownerField: personal.of, ...(whenAbsent !== undefined && { whenAbsent }) },
  };
}

// Resolves the author-facing `personal`/`find` annotations
// into the internal ResolvedPiiFlags every factory below merges into its
// return value. `personal`, `find`, `reason` never survive into the field def.
function expandPersonalAnnotations<T extends PersonalOverridesInput>(
  overrides: T | undefined,
): Omit<T, "personal" | "find" | "reason"> & ResolvedPiiFlags {
  if (!overrides) {
    return {} as Omit<T, "personal" | "find" | "reason"> & ResolvedPiiFlags;
  }
  const { personal, find, reason, anonymize, ...rest } = overrides;

  const personalFlags = resolvePersonalFlags(personal, reason);

  // `searchable`/`sensitive` live on the individual FieldDef, not on
  // ResolvedPiiFlags — "fuzzy"/"secret" resolve into those too.
  let findFlags: ResolvedPiiFlags & { searchable?: boolean; sensitive?: boolean } = {};
  if (find === "exact") {
    findFlags = { lookupable: true };
  } else if (find === "fuzzy") {
    findFlags = { lookupable: true, searchable: true };
  } else if (find === "secret") {
    findFlags = { sensitive: true };
  }

  return {
    ...rest,
    ...personalFlags,
    ...findFlags,
    ...(anonymize ? { anonymize } : {}),
  } as Omit<T, "personal" | "find" | "reason"> & ResolvedPiiFlags;
}

type TextFieldStanceFactory = "createTextField" | "createLongTextField";

// `find` is mandatory once a subject is named (types require it — see
// PersonalAnnotations / PersonalAnnotationsLongText), but the valid values
// differ per factory: longText has no lookup/search machinery.
const TEXT_FIELD_STANCE_FIND_VALUES: Record<TextFieldStanceFactory, readonly Findability[]> = {
  createTextField: ["exact", "fuzzy", "none", "secret"],
  createLongTextField: ["none", "secret"],
};

function textFieldStanceHint(factoryName: TextFieldStanceFactory): string {
  const find = TEXT_FIELD_STANCE_FIND_VALUES[factoryName].map((f) => `"${f}"`).join(" | ");
  return (
    `{ personal: "self", find: ${find} }, ` +
    `{ personal: "tenant", find: ${find} }, ` +
    `{ personal: { of: "<ownerField>" }, find: ${find} }, ` +
    `{ personal: "ref" }, or ` +
    `{ personal: false, reason: "<why this is not personal data>" }`
  );
}

function missingTextFieldStanceError(factoryName: TextFieldStanceFactory): Error {
  return new Error(
    `${factoryName}(...) must declare an explicit personal-data stance — a text field must state whose data it holds and (unless it isn't personal data) how findable it needs to stay (kumiko-framework#2921). Pass one of: ${textFieldStanceHint(factoryName)}. Run \`kumiko-guards guards --guard="Text-Field Personal-Stance Guard"\` to find remaining call sites.`,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Fail-closed stance gate for the two text-shaped
// factories — runs before expandPersonalAnnotations so an untyped JS caller
// (no compiler to stop it) can't slip an unannotated text field past the
// type layer either. The typed signature above already rejects a
// missing/malformed shape at compile time; this re-checks the same shape at
// runtime, hence the nullable parameter.
function assertTextFieldStance(
  factoryName: TextFieldStanceFactory,
  overrides: PersonalOverridesInput | null | undefined,
): void {
  if (overrides === null || typeof overrides !== "object") {
    throw missingTextFieldStanceError(factoryName);
  }
  const { personal, find, reason } = overrides;
  if (personal === undefined || personal === null) {
    throw missingTextFieldStanceError(factoryName);
  }
  if (personal === "ref") {
    // skip: a user reference carries no content of its own, so no `find` applies
    return;
  }
  if (personal === false) {
    if (!isNonEmptyString(reason)) {
      throw missingTextFieldStanceError(factoryName);
    }
    // skip: plaintext by declaration, `find` only applies to a named subject
    return;
  }
  const hasValidSubject =
    personal === "self" ||
    personal === "tenant" ||
    (typeof personal === "object" && isNonEmptyString(personal.of));
  if (!hasValidSubject) {
    throw missingTextFieldStanceError(factoryName);
  }
  const validFinds = TEXT_FIELD_STANCE_FIND_VALUES[factoryName];
  if (typeof find !== "string" || !isOneOf(validFinds, find)) {
    throw missingTextFieldStanceError(factoryName);
  }
}

// Use generic `R extends true | false` instead of `boolean` so
// `createTextField({ required: true })` preserves the literal `required: true`
// in the return type. Widening to `boolean` would prevent EntityTable<E>'s
// Mapped-Type from distinguishing `required: true` from `required: false`,
// making every column nullable. Default `R = false` matches the runtime
// default. This pattern is used in every required-bearing factory below.
export function createTextField<R extends true | false = false>(
  overrides: Partial<Omit<TextFieldDef, "type" | "required" | keyof ResolvedPiiFlags>> &
    PersonalAnnotations & { required?: R },
): EntityTextFieldDef & { required: R } {
  assertTextFieldStance("createTextField", overrides);
  return {
    type: "text",
    maxLength: 200,
    required: false,
    searchable: false,
    sortable: false,
    ...expandPersonalAnnotations(overrides),
  } as EntityTextFieldDef & { required: R }; // @cast-boundary engine-payload
}

/**
 * Long-form text field for source-code, markdown, blog-posts, email-
 * templates — anything that can be megabytes large. Its type-level API
 * differs from `text`: it has no sortable/searchable/filterable/format options.
 * The DB mapping is identical to text (`PG text` is unbounded).
 *
 * Soft-cap default: no maxLength (`PG text` has a 1 GB hard limit).
 * Set an explicit `maxLength` to reject an accidental browser paste early
 * (for example, `1_000_000 = 1 MB`).
 */
/**
 * Read-time computed field for `EntityDefinition.derivedFields` (NOT `fields`).
 * The value is derived per row from the stored columns + the clock at query
 * time, never persisted. Display only — server-side sort/filter/search don't
 * apply and there's no client-side sort path (see DerivedFieldDef). `derive`
 * must take its clock from `ctx.asOf`, never `Temporal.Now`/`Date`.
 */
export function createDerivedField(spec: DerivedFieldDef): DerivedFieldDef {
  return { ...spec };
}

export function createLongTextField<R extends true | false = false>(
  overrides: Partial<Omit<LongTextFieldDef, "type" | "required" | keyof ResolvedPiiFlags>> &
    PersonalAnnotationsLongText & { required?: R },
): EntityLongTextFieldDef & { required: R } {
  assertTextFieldStance("createLongTextField", overrides);
  return {
    type: "longText",
    required: false,
    ...expandPersonalAnnotations(overrides),
  } as EntityLongTextFieldDef & { required: R }; // @cast-boundary engine-payload
}

export function createBooleanField<R extends true | false = false>(
  overrides?: Partial<Omit<BooleanFieldDef, "type" | "required">> & { required?: R },
): BooleanFieldDef & { required: R; default: boolean } {
  return {
    type: "boolean",
    required: false,
    default: false,
    ...overrides,
  } as BooleanFieldDef & { required: R; default: boolean }; // @cast-boundary engine-payload
}

export function createSelectField<
  const TOptions extends readonly string[],
  R extends true | false = false,
>(
  opts: { options: TOptions } & Partial<
    Omit<
      SelectFieldDef<NoInfer<TOptions>>,
      "type" | "options" | "required" | keyof ResolvedPiiFlags
    >
  > &
    PersonalAnnotationsNoFind & { required?: R },
): SelectFieldDef<TOptions> & { required: R } {
  return {
    type: "select",
    required: false,
    ...expandPersonalAnnotations(opts),
  } as SelectFieldDef<TOptions> & { required: R }; // @cast-boundary engine-payload
}

/**
 * Multi-select field — N values from a fixed option list.
 *
 * Storage: jsonb-Array<string>. Every entry must be in `options`
 * (boot-validator). Renders as a combobox dropdown by default; set
 * `display: "checkboxes"` to render every option as a visible checkbox with
 * a select-all toggle instead.
 *
 * ```ts
 * licenceClasses: createMultiSelectField({
 *   options: ["B", "BE", "C", "C1", "CE", "C1E", "D", "D1"] as const,
 *   default: ["B"],
 * }),
 *
 * languages: createMultiSelectField({
 *   options: ["en", "de", "es", "fr", "it"] as const,
 *   display: "checkboxes",
 *   columns: 2,
 * }),
 * ```
 *
 * Caller-API:
 *   Write: `{ licenceClasses: ["B", "BE", "C1"] }`
 *   Read:  `{ licenceClasses: ["B", "BE", "C1"] }`
 *
 * Use instead of `select` when more than one value can be chosen at once.
 * Use instead of `embedded` with booleans once there are more than ~5 options.
 */
export function createMultiSelectField<const TOptions extends readonly string[]>(
  opts: { options: TOptions } & Partial<
    Omit<MultiSelectFieldDef<TOptions>, "type" | "options" | keyof ResolvedPiiFlags>
  > &
    PersonalAnnotationsNoFind,
): MultiSelectFieldDef<TOptions> {
  return {
    type: "multiSelect",
    required: false,
    ...expandPersonalAnnotations(opts),
  };
}

/**
 * Numeric field — `double precision` column by default (fractional values
 * allowed end to end). Pass `integer: true` for a 32-bit `integer` column
 * with `.int()` write-boundary validation. Need exact decimal storage
 * instead (money-adjacent math)? Use `createDecimalField` (`numeric`).
 */
export function createNumberField<R extends true | false = false>(
  overrides?: Partial<Omit<NumberFieldDef, "type" | "required" | keyof ResolvedPiiFlags>> &
    PersonalAnnotationsNoFind & { required?: R },
): NumberFieldDef & { required: R } {
  return {
    type: "number",
    required: false,
    ...expandPersonalAnnotations(overrides),
  } as NumberFieldDef & { required: R }; // @cast-boundary engine-payload
}

export function createBigIntField<R extends true | false = false>(
  overrides?: Partial<Omit<BigIntFieldDef, "type" | "required" | keyof ResolvedPiiFlags>> &
    PersonalAnnotationsNoFind & { required?: R },
): BigIntFieldDef & { required: R } {
  return {
    type: "bigInt",
    required: false,
    ...expandPersonalAnnotations(overrides),
  } as BigIntFieldDef & { required: R }; // @cast-boundary engine-payload
}

// Exact decimal column — numeric(precision, scale). precision/scale are
// required (no truncating default). See DecimalFieldDef for the precision
// caveat (surfaced as JS number, safe ≤ 2^53).
export function createDecimalField<R extends true | false = false>(
  config: { precision: number; scale: number } & Partial<
    Omit<DecimalFieldDef, "type" | "precision" | "scale" | "required" | keyof ResolvedPiiFlags>
  > &
    PersonalAnnotationsNoFind & { required?: R },
): DecimalFieldDef & { required: R } {
  // Fail at definition time, not at the first migration: numeric(p,s) requires
  // integer p ≥ 1 and 0 ≤ s ≤ p (Postgres rejects e.g. numeric(2,4), and the
  // schema-builder's `10 ** (precision - scale)` bound goes nonsensical).
  const { precision, scale } = config;
  if (
    !Number.isInteger(precision) ||
    !Number.isInteger(scale) ||
    precision < 1 ||
    scale < 0 ||
    scale > precision
  ) {
    throw new Error(
      `createDecimalField: precision/scale must be integers with precision ≥ 1 and ` +
        `0 ≤ scale ≤ precision, got precision=${precision}, scale=${scale}`,
    );
  }
  return {
    type: "decimal",
    required: false,
    ...expandPersonalAnnotations(config),
  } as DecimalFieldDef & { required: R }; // @cast-boundary engine-payload
}

export function createMoneyField<R extends true | false = false>(
  overrides?: Partial<Omit<MoneyFieldDef, "type" | "required">> & { required?: R },
): MoneyFieldDef & { required: R } {
  return {
    type: "money",
    ...overrides,
  } as MoneyFieldDef & { required: R }; // @cast-boundary engine-payload
}

export function createEmbeddedField(
  schema: EmbeddedFieldDef["schema"],
  overrides?: Partial<Omit<EmbeddedFieldDef, "type" | "schema" | keyof ResolvedPiiFlags>> &
    PersonalAnnotationsNoFind,
): EmbeddedFieldDef {
  return {
    type: "embedded",
    schema,
    ...expandPersonalAnnotations(overrides),
  };
}

// A list of like-shaped objects — see `EmbeddedFieldDef.multiple` for when an
// embedded list is the right model and when the rows belong in their own
// entity. `required: true` means the insert must carry the key AND at least
// one row (analogous to multiSelect); the column itself is never null, it
// defaults to `[]`.
//
// The `multiple: true` literal is part of the return type because the
// table-builder's ColumnsForField branches on it — a widened `boolean` would
// silently fall back to the single-object column type.
export function createEmbeddedListField(
  schema: EmbeddedFieldDef["schema"],
  overrides?: Partial<
    Omit<EmbeddedFieldDef, "type" | "schema" | "multiple" | keyof ResolvedPiiFlags>
  > &
    PersonalAnnotationsNoFind,
): EmbeddedFieldDef & { multiple: true } {
  return {
    type: "embedded",
    schema,
    ...expandPersonalAnnotations(overrides),
    multiple: true,
  };
}

// Free-form jsonb column — see the `JsonbFieldDef` documentation. Schema-less,
// defaults to `{}`, and is NOT NULL. Primarily used by the custom-fields
// bundle for the host entity's `customFields` column; other valid uses include
// tenant configuration blobs, AI-inferred metadata, and future tag arrays.
export function createJsonbField(
  overrides?: Partial<Omit<JsonbFieldDef, "type" | keyof ResolvedPiiFlags>> &
    PersonalAnnotationsNoFind,
): JsonbFieldDef {
  return {
    type: "jsonb",
    ...expandPersonalAnnotations(overrides),
  };
}

export function createDateField<R extends true | false = false>(
  overrides?: Partial<Omit<DateFieldDef, "type" | "required" | keyof ResolvedPiiFlags>> &
    PersonalAnnotationsNoFind & { required?: R },
): DateFieldDef & { required: R } {
  return {
    type: "date",
    required: false,
    ...expandPersonalAnnotations(overrides),
  } as DateFieldDef & { required: R }; // @cast-boundary engine-payload
}

/**
 * UTC instant for events occurring at a specific point in time
 * (createdAt, loginAt, actualPickupAt). Uses Temporal.Instant internally.
 *
 * With `locatedBy: "<name>Tz"`, the field becomes a wall-clock pair for an
 * appointment at a location — prefer `createLocatedTimestampField()` instead,
 * which creates one atomic field rather than a loosely connected pair.
 */
export function createTimestampField<R extends true | false = false>(
  overrides?: Partial<Omit<TimestampFieldDef, "type" | "required" | keyof ResolvedPiiFlags>> &
    PersonalAnnotationsNoFind & { required?: R },
): TimestampFieldDef & { required: R } {
  // Building the object this way avoids hardcoding `required: false` in the
  // literal, which would make TypeScript widen R to `boolean` instead of
  // inferring the `true`/`false` literal from the overrides argument.
  return {
    ...expandPersonalAnnotations(overrides),
    type: "timestamp",
    required: (overrides?.required ?? false) as R, // @cast-boundary engine-payload
  };
}

/**
 * IANA time-zone name (for example, "Europe/Berlin"). The boot/schema
 * validator checks it using `Intl.supportedValuesOf("timeZone")` during the
 * Zod step.
 */
export function createTzField<R extends true | false = false>(
  overrides?: Partial<Omit<TzFieldDef, "type" | "required" | keyof ResolvedPiiFlags>> &
    PersonalAnnotationsNoFind & { required?: R },
): TzFieldDef & { required: R } {
  return {
    type: "tz",
    required: false,
    ...expandPersonalAnnotations(overrides),
  } as TzFieldDef & { required: R }; // @cast-boundary engine-payload
}

/**
 * Wall-clock time at a place as one atomic field. Use it for every date
 * value tied to a location (pickup, delivery, meeting, schedule).
 *
 * One schema field maps to two DB columns (`<name>_utc TIMESTAMPTZ` +
 * `<name>_tz TEXT`) and to three API fields on read (`{ at, tz, utc }`).
 *
 * ```ts
 * r.entity({
 *   name: "order",
 *   fields: {
 *     pickup: createLocatedTimestampField(),
 *     delivery: createLocatedTimestampField(),
 *   },
 * });
 *
 * // Write: the caller sends at+tz, the framework computes utc
 * await create({ pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" } });
 *
 * // Read: the framework returns all three fields
 * // → { pickup: { at: "10:00", tz: "Europe/Lisbon", utc: "09:00Z" } }
 *
 * // Sort/filter on the UTC column
 * orderBy(asc(orderTable.pickupUtc))
 * where(between(orderTable.pickupUtc, start, end))
 * ```
 *
 * `at` is local to the place (what was entered comes back on the same day).
 * A user-local view is computed separately from `utc`.
 */
export function createLocatedTimestampField<R extends true | false = false>(
  overrides?: Partial<
    Omit<LocatedTimestampFieldDef, "type" | "required" | keyof ResolvedPiiFlags>
  > &
    PersonalAnnotationsNoFind & { required?: R },
): LocatedTimestampFieldDef & { required: R } {
  return {
    type: "locatedTimestamp",
    required: false,
    ...expandPersonalAnnotations(overrides),
  } as LocatedTimestampFieldDef & { required: R }; // @cast-boundary engine-payload
}

export function createFileField(
  overrides?: Partial<Omit<FileFieldDef, "type" | keyof ResolvedPiiFlags>> &
    PersonalAnnotationsNoFind,
): FileFieldDef {
  return { type: "file", ...expandPersonalAnnotations(overrides) };
}

export function createImageField(
  overrides?: Partial<Omit<ImageFieldDef, "type" | keyof ResolvedPiiFlags>> &
    PersonalAnnotationsNoFind,
): ImageFieldDef {
  return { type: "image", ...expandPersonalAnnotations(overrides) };
}

export function createFilesField(
  overrides?: Partial<Omit<FilesFieldDef, "type" | keyof ResolvedPiiFlags>> &
    PersonalAnnotationsNoFind,
): FilesFieldDef {
  return { type: "files", ...expandPersonalAnnotations(overrides) };
}

export function createImagesField(
  overrides?: Partial<Omit<ImagesFieldDef, "type" | keyof ResolvedPiiFlags>> &
    PersonalAnnotationsNoFind,
): ImagesFieldDef {
  return { type: "images", ...expandPersonalAnnotations(overrides) };
}

// Leave `F` unconstrained so TypeScript preserves the literal types of
// individual field definitions (`required: true` remains `true`, not
// `boolean`). Constraining it to FieldsMap would widen them — see the
// TypeScript issue concerning constraint inference for structural records.
// Instead, conformance is validated through the conditional return type: if F
// is not compatible with FieldsMap, the return type collapses to `never`.
// `const F` preserves the `type` literal in inline field literals
// (`{ type: "reference", ... }`) without `as const`; otherwise it widens to
// string and produces `never`.
export function createEntity<const F, const T extends EntityTenancy = "tenant">(def: {
  readonly table?: string;
  readonly fields: F;
  readonly description?: string;
  readonly softDelete?: boolean;
  /** Event stream lives on SYSTEM_TENANT_ID (tenant-independent aggregate, e.g.
   *  user) instead of the creator's tenant. See EntityDefinition.systemStream. */
  readonly systemStream?: boolean;
  readonly eventVersion?: number;
  readonly eventMigrations?: EntityDefinition["eventMigrations"];
  readonly searchWeight?: number;
  readonly defaultCurrency?: string;
  readonly transitions?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /** See EntityDefinition.lockedWhen. */
  readonly lockedWhen?: EntityDefinition["lockedWhen"];
  readonly indexes?: readonly EntityIndexDef[];
  readonly idType?: "serial" | "uuid";
  readonly access?: EntityDefinition["access"];
  /** Join-row carrier reference — see EntityDefinition.parentRef. */
  readonly parentRef?: EntityDefinition["parentRef"];
  readonly retention?: RetentionDef;
  readonly derivedFields?: EntityDefinition["derivedFields"];
  readonly tenancy?: T;
  /** See EntityDefinition.transferable. */
  readonly transferable?: boolean;
  /** See EntityDefinition.attachedFileAccess. */
  readonly attachedFileAccess?: EntityDefinition["attachedFileAccess"];
}): F extends FieldsMap ? EntityDefinition<F, T> : never {
  return {
    softDelete: false,
    searchWeight: 1,
    // Default to UUID — post-ES-pivot every entity is event-sourced and
    // aggregate-ids are UUID. Opt-out with `idType: "serial"` for pre-ES
    // legacy tables (should be rare).
    ...def,
  } as F extends FieldsMap ? EntityDefinition<F, T> : never; // @cast-boundary engine-payload
}
