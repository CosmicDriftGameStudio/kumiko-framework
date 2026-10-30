/// <reference types="temporal-polyfill/global" preserve="true" />
// --- Field Types ---

import type { VariantSpec } from "./derivatives-types.ts";
import type {
  EmbeddedDerivedCellDef,
  EmbeddedFilesSubFieldProps,
  EmbeddedImagesSubFieldProps,
  FieldCondition,
  FieldStateConditions,
} from "./field-state-conditions.ts";

export type {
  EmbeddedDerivedCellDef,
  EmbeddedFilesSubFieldProps,
  EmbeddedImagesSubFieldProps,
  FieldCondition,
  FieldStateConditions,
} from "./field-state-conditions.ts";

// OwnershipMap is declared in ./ownership.ts — field-access maps to
// per-role ownership rules. A legacy `readonly string[]` form is still
// accepted at the type layer during migration: features that pass an
// array are auto-normalized to { [role]: "all" } at registry build.
// Long-term: string[] disappears.
import type { ParentRefDef, ReadGateDef } from "./entity-row-visibility.ts";
import type { DerivedFieldsMap } from "./fields-derived.ts";
import type { EventUpcastCtx } from "./handlers.ts";
import type { NamedListFilterDef } from "./named-list-filters.ts";
import type { OwnershipMap } from "./ownership.ts";
import type { EntityTenancy } from "./tenancy-brand.ts";

export type {
  ClientDerivedFieldDef,
  DeriveContext,
  DerivedCondition,
  DerivedConditionValue,
  DerivedFieldDef,
  DerivedFieldsMap,
  DerivedRelatedMeasure,
  DerivedSqlSpec,
  DerivedValueType,
  JsDerivedFieldDef,
  SqlDerivedFieldDef,
} from "./fields-derived.ts";
export { isSqlDerivedField } from "./fields-derived.ts";

export type FieldAccess = {
  readonly read?: OwnershipMap | readonly string[];
  readonly write?: OwnershipMap | readonly string[];
};

// `sensitive: true` — the field's value is excluded from caller-facing event
// echoes in write responses and MUST be ciphertext-at-rest: boot
// validation requires a subject annotation (pii / userOwned / tenantOwned)
// or `encrypted: true`. Event payloads carry the table ciphertext,
// so replay reproduces the row byte-identically; plaintext never lands in
// permanent history. Use for password hashes, API tokens, bank details,
// tax IDs. See docs/plans/architecture/projections.md.

// --- PII / Subject-Key Annotations (GDPR Art. 17) ---
//
// Four independent mechanisms, NOT interchangeable. Picking the wrong
// `personal`/`find` combination is the recurring mistake this table exists
// to prevent: `encrypted: true` looks like the strongest option and is the
// only one with NO erasure guarantee.
//
//   resolved flag                               | at rest    | searchable | Art. 17 erasure
//   --------------------------------------------|------------|------------|---------------
//   (none)                                      | plaintext  | yes        | no
//   allowPlaintext + anonymize                  | plaintext  | yes        | read side only
//   pii / userOwned / tenantOwned / recordOwned | ciphertext | yes *      | yes, key erase
//   encrypted: true                             | ciphertext | no         | NO
//
//   * Subject-annotated + `searchable: true`: search consumer
//     decrypts into Meilisearch. Events/projection stay ciphertext.
//     eraseKey paths purge docs via purgeSearchDocumentsForSubject.
//     `lookupable: true` still covers equality (blind index). `sortable`
//     stays forbidden — sorting reads the ciphertext column.
//
// Encrypting a field is NOT a reason to make it unfindable. A user table you
// cannot search by name is a user table with no working search. The line that
// actually forbids search is `sensitive: true` — ciphertext at rest, never
// searchable, stripped from event echoes before the search consumer ever sees
// a payload (authorized readers can still read the value back). Password
// hashes, API tokens, bank details: never indexed. Email, username, display
// name: encrypted at rest, findable. A value that must never be returned at
// all takes `writeOnly: true` on top.
//
// Why `encrypted: true` erases nothing: it uses the app-wide master key,
// which is never destroyed per subject. Encryption-at-rest, nothing more.
// Only a subject annotation binds the field to a per-subject key that
// `crypto-shredding:write:forget-subject` (or the tenant-destroy hook's
// eraseSubjectKeys) can destroy, which makes every event and every
// projection copy of that subject unreadable at once.
//
// Why `anonymize` only covers the read side: it overwrites projection rows.
// `kumiko_events` is append-only and keeps the original payload forever
// (archiveStream stops REPLAY, it does not delete the row). A plaintext
// field stays permanently readable in the event log for anyone with database
// access — an access + retention question, not a crypto one. Choose it
// deliberately, not by forgetting to annotate.
//
// Which subject owns the field — expressed via `personal` on the field
// factory, resolved to these flags:
//   - `personal: "self"`         → `pii: true`. the entity itself, user.email.
//   - `personal: { of: "<f>" }`  → `userOwned: { ownerField: "<f>" }`. the
//                                  user referenced in that field.
//                                  comment.body → comment.authorId.
//                                  `whenAbsent: "tenant"` encrypts rows whose
//                                  owner is empty under the tenant key instead
//                                  of failing; a nullable owner needs it.
//                                  `whenAbsent: "self"` encrypts
//                                  them under the row's own record key instead,
//                                  so a record-forget shreds the value.
//   - `personal: "tenant"`       → `tenantOwned: true`. the current tenant
//                                  (ctx.tenantId at write time).
//                                  tenantBranding.brandColor.
//   - `personal: "ref"`          → `subjectRef: true`. FK into `user` with no
//                                  annotated content of its own (authorId,
//                                  assigneeId).
//   - `personal: { of: "id" }`   → `recordOwned: true`. the row itself is the
//                                  subject — free-text content with no user
//                                  reference of its own (a support note keyed
//                                  only by its own row id).
//   - `personal: false, reason`  → `allowPlaintext: "<reason>"`. deliberately
//                                  plaintext; `reason` is mandatory snake_case.
//
// How findable it must stay — `find`, mandatory whenever `personal` names a
// subject ("self" / { of } / "tenant"):
//   - `find: "exact"`  → `lookupable: true`. equality only, via blind index.
//   - `find: "fuzzy"`  → `lookupable: true, searchable: true`. substring/
//                        full-text via the Meilisearch consumer.
//   - `find: "none"`   → neither.
//   - `find: "secret"` → `sensitive: true`. longText fields only allow
//                        "none" | "secret" — no lookup/search machinery there.
//
// Worked examples, all live in this repo:
//
//   user.email (user/schema/user.ts) — login identifier, must stay findable.
//     `personal: "self", find: "exact"`. Ciphertext everywhere, exact lookup
//     via the blind index, gone when the user's subject key dies.
//
//   user.displayName (same file) — real name; substring search via Meili.
//     `personal: "self", find: "fuzzy"`. Ciphertext in
//     events/projection; plaintext only in the derived index; purged on
//     forget.
//
//   ledger.description (ledger/entity.ts) — "January rent" is accounting
//     data that happens to read like PII, and full-text search over it is the
//     point. `personal: false, reason: "is_business_data"`, cleaned up via
//     retention, event log keeps the original. Accepted deliberately.
//
//   subscription.providerCustomerId (billing-foundation/entities.ts) — a
//     Mollie/Stripe id, never searched. `personal: "tenant", find: "none"`,
//     explicitly NOT `encrypted: true`: tenant-destroy erases the tenant
//     subject key, and only the subject path shreds along with it.
//     Budget maxLength for ciphertext
//     (`kumiko-pii:v1:<subject>:<blob>`, roughly plaintext × 2.3).
//
// `sensitive: true` is orthogonal to all of this — see its own note above.
//
// `anonymize` is the per-field function the retention-cleanup job calls when
// the entity strategy is "anonymize" or a `blockDelete` deadline expired.
// Sync or async (async when the pseudonym needs a lookup); the job awaits it.
// Example: `() => "[ANONYMIZED]"` or `() => null`.
//
// Background specs (both shipped, kumiko-platform/docs/archive/plans/):
// datenschutz/crypto-shredding.md, datenschutz/blind-index.md.
// Internal, expanded flag shape a field definition carries after a factory
// (createTextField, createTimestampField, ...) resolves the author-facing
// `personal`/`find` annotations below. No field author sets this directly.
export type ResolvedPiiFlags = {
  readonly pii?: boolean;
  readonly userOwned?: {
    readonly ownerField: string;
    readonly whenAbsent?: EntityPiiAbsentSubject;
  };
  readonly tenantOwned?: boolean;
  readonly recordOwned?: true;
  readonly anonymize?: () => unknown | Promise<unknown>;
  readonly allowPlaintext?: string;
  /** Equality lookups (`fetchOne`/`filter eq`) remain possible despite encryption:
   *  the generated `<snake>_bidx` column carries an HMAC blind index, and the
   *  query compiler matches `(col = $1 OR col_bidx = $2)`. Allowed only on text
   *  fields with subject annotations, as enforced by the boot validator. */
  readonly lookupable?: true;
  /** Foreign key into the `user` entity (authorId, assigneeId, ...) with no
   *  annotated content of its own. Triggers no encryption — feeds only the
   *  GDPR-hook-coverage boot guard, which otherwise can't see subject data
   *  that lives purely in an FK column. */
  readonly subjectRef?: true;
};

type PiiAndFieldState = ResolvedPiiFlags & FieldStateConditions;

// --- Author-facing PII API ---
//
// Two questions instead of the twelve raw flags above: whose data is this
// (`personal`, resolved to a subject key) and how findable must it stay
// (`find`, resolved to the search/lookup flags). Field factories expand
// these into `ResolvedPiiFlags` — see packages/framework/src/engine/factories.ts.
// Entity fields have no plaintext fallback for an ownerless row: stored PII
// must stay shreddable.
export type EntityPiiAbsentSubject = "tenant" | "self";
export type PersonalSubject =
  | "self"
  | { readonly of: string; readonly whenAbsent?: EntityPiiAbsentSubject }
  | "tenant";
export type Findability = "exact" | "fuzzy" | "none" | "secret";

// Marks "no personal annotation given" — plain `Record<string, never>` would
// force every OTHER intersected property (e.g. a factory's `required?: R`)
// to `never` too, since its index signature applies to all string keys.
// Naming the three annotation keys explicitly avoids that trap.
//
// No longer part of PersonalAnnotations /
// PersonalAnnotationsLongText — text and longText fields must declare an
// explicit stance. It still applies to PersonalAnnotationsNoFind, whose
// factories keep `personal` optional.
type NoPersonalAnnotation = {
  readonly personal?: never;
  readonly find?: never;
  readonly reason?: never;
  readonly anonymize?: never;
};

export type PersonalAnnotations =
  | {
      readonly personal: PersonalSubject;
      readonly find: Findability;
      readonly anonymize?: () => unknown | Promise<unknown>;
    }
  | { readonly personal: "ref" }
  | {
      readonly personal: false;
      readonly reason: string;
      readonly anonymize?: () => unknown | Promise<unknown>;
    };

// longText has no lookupable/searchable machinery ("Kein searchable" — see
// LongTextFieldDef doc) — only "does this need to stay a secret" applies.
// Kept mandatory like `find` on PersonalAnnotations: no silent default.
export type LongTextFindability = "none" | "secret";

export type PersonalAnnotationsLongText =
  | {
      readonly personal: PersonalSubject;
      readonly find: LongTextFindability;
      readonly anonymize?: () => unknown | Promise<unknown>;
    }
  | { readonly personal: "ref" }
  | {
      readonly personal: false;
      readonly reason: string;
      readonly anonymize?: () => unknown | Promise<unknown>;
    };

// Same as PersonalAnnotations but without `find` — for field types with no
// full-text/blind-index machinery (everything except text and longText).
export type PersonalAnnotationsNoFind =
  | {
      readonly personal: PersonalSubject;
      readonly anonymize?: () => unknown | Promise<unknown>;
    }
  | { readonly personal: "ref" }
  | {
      readonly personal: false;
      readonly reason: string;
      readonly anonymize?: () => unknown | Promise<unknown>;
    }
  | NoPersonalAnnotation;

// --- Retention (GDPR Art. 5(1)(e) + statutory retention requirements) ---
//
// Each entity defines a default retention policy. Tenant administrators can
// override it through compliance profiles and tenant overrides.
// Four strategies:
//
//   - "hardDelete"  — physically remove the row after `keepFor`. Logs, sessions.
//   - "softDelete"  — set `deletedAt = now()`, allowing later restoration.
//   - "anonymize"   — overwrite fields with an `anonymize` function while the
//                     row remains. Orders/invoices with mixed personal and
//                     business data.
//   - "blockDelete" — the cleanup job skips the row; user forget instead
//                     triggers `anonymize`. Accounting records, mandates,
//                     patient records.
//
// `keepFor` is a duration string such as "30d", "10y", or "6m". The cleanup
// job parses it. `reference` supplies the lifetime anchor (default:
// `createdAt`); sessions can use `lastSeenAt` so active sessions are retained.
export type RetentionDef = {
  readonly keepFor: string;
  readonly strategy: "hardDelete" | "softDelete" | "anonymize" | "blockDelete";
  readonly reference?: string;
};

/** Where rows without a value sort in a list, in both directions. Without it Postgres decides:
 *  last ascending, first descending. */
export type SortNulls = "first" | "last";

export type TextFieldDef = {
  readonly type: "text";
  /** Optional free-text semantics for the AI agent manifest — never rendered;
   *  the i18n label is what users see. */
  readonly description?: string;
  readonly maxLength?: number;
  /** Lower bound enforced by the generated write schema, so short input is
   *  rejected by validation instead of reaching the handler. */
  readonly minLength?: number;
  /** HTML `autocomplete` token for the rendered input (e.g. "one-time-code"),
   *  so browsers and password managers offer or suppress autofill correctly. */
  readonly autoComplete?: string;
  readonly required?: boolean;
  readonly searchable?: boolean;
  readonly sortable?: boolean;
  readonly sortNulls?: SortNulls;
  /** Allows screen filters on this field.
   *  The boot validator rejects filters with `filterable !== true`.
   *  Default: false, analogous to `sortable`, and therefore opt-in. */
  readonly filterable?: boolean;
  readonly encrypted?: boolean;
  readonly sensitive?: boolean;
  /** Write-only secret (API key): the value is never returned to clients. Reads
   *  (list/detail/write responses) show `true` = set, `null` = empty. Writes:
   *  `""` or omitted = unchanged, `null` = clear, string = new value.
   *  Server-side: executor reads (detail/list in server handlers) and
   *  postSave/postQuery hooks see the plaintext; ctx.dispatch.query, dispatcher.query,
   *  agent tools and `_refs` see true/null; ctx.db sees the ciphertext.
   *  Known limit: masking runs for entity-bound query handlers with array /
   *  {rows} / flat results; an unbound custom query handler that returns
   *  executor rows must call maskWriteOnlyFields itself (same scope limit as
   *  access.read). Requires `sensitive` (via `find: "secret"`); forbidden with
   *  default/searchable/sortable/filterable/lookupable and on inline form fields
   *  (actionForm/wizard). Allowed on configEdit text fields only over an
   *  encrypted-at-rest config key, where it is also set automatically. */
  readonly writeOnly?: boolean;
  /** A later run reads this field's value as an instruction — prompt, rule,
   *  template. Every create/update whose payload writes it requires agent.risk
   *  "high" on the directly-dispatched entry handler; a revert doesn't undo a
   *  run that already read the compromised value. See irreversible-operation-gate. */
  readonly readAsInstruction?: boolean;
  /** "password" is a pure render hint (masked input) — no storage semantics.
   *  "month" stores `YYYY-MM`: month picker in the form, format enforced on write.
   *  "iban" is checked on write (shape plus mod-97); the value is stored as typed. */
  readonly format?: "email" | "url" | "phone" | "password" | "month" | "iban";
  readonly default?: string;
  readonly access?: FieldAccess;
  /** Multiline text causes DefaultInput to render a <textarea> instead of
   *  <input type="text">. `true` uses four rows by default; `{ rows: N }`
   *  sets an explicit height. Search, sort, and encryption remain unchanged;
   *  only the rendering surface differs. */
  readonly multiline?: boolean | { readonly rows?: number };
} & PiiAndFieldState;

/**
 * Long-form text content — source code, markdown, blog posts, email
 * templates, and anything that can be megabytes large. Its surface is
 * intentionally minimal compared with `text`:
 *
 *   - **No `sortable`**: ordering 100 KB strings costs I/O without useful UX;
 *     lexicographic ordering of code is not meaningful.
 *   - **No `searchable`**: ILIKE/substring searches do not scale on long text.
 *     Full-text search should use the SearchAdapter (Meilisearch), which has
 *     its own tokenizer and index rather than this field flag.
 *   - **No `filterable`**: filtering long strings has the same issue as sorting.
 *   - **No `format`**: email/url/phone are short, structured inputs, whereas
 *     longText is unstructured by definition.
 *
 * Type-level enforcement means callers who need sorting or searching must use
 * `text` and accept its scaling trade-offs. Database mapping is identical to
 * `text` (Postgres `text` is unbounded).
 */
export type LongTextFieldDef = {
  readonly type: "longText";
  readonly description?: string;
  /** Optional soft cap. Default is unbounded (= Postgres text limit, 1 GB).
   *  Useful for defensive limits such as 1 MB so an accidental browser paste
   *  does not overwhelm the database. */
  readonly maxLength?: number;
  readonly required?: boolean;
  readonly encrypted?: boolean;
  readonly sensitive?: boolean;
  /** A later run reads this field's value as an instruction — prompt, rule,
   *  template. Every create/update whose payload writes it requires agent.risk
   *  "high" on the directly-dispatched entry handler; a revert doesn't undo a
   *  run that already read the compromised value. See irreversible-operation-gate. */
  readonly readAsInstruction?: boolean;
  readonly default?: string;
  readonly access?: FieldAccess;
  readonly multiline?: boolean | { readonly rows?: number };
} & PiiAndFieldState;

export type BooleanFieldDef = {
  readonly type: "boolean";
  readonly description?: string;
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly sortNulls?: SortNulls;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly default?: boolean;
  readonly access?: FieldAccess;
} & FieldStateConditions;

export const SELECT_OPTION_TONES = ["ok", "warn", "bad", "critical", "accent", "neutral"] as const;

export type SelectOptionTone = (typeof SELECT_OPTION_TONES)[number];

/** One `optionsQueryPayload` entry: a literal, or `{ field }` = the current value of
 *  a sibling field of the same form (config keys: another key of the owner feature). */
export type OptionsQueryPayloadValue = string | number | boolean | { readonly field: string };

export type OptionsQueryPayload = Readonly<Record<string, OptionsQueryPayloadValue>>;

export function isOptionsQueryFieldRef(
  value: OptionsQueryPayloadValue,
): value is { readonly field: string } {
  return typeof value === "object" && value !== null;
}

export function optionsQueryFieldRefs(payload: OptionsQueryPayload | undefined): string[] {
  return Object.values(payload ?? {})
    .filter(isOptionsQueryFieldRef)
    .map((ref) => ref.field);
}

/** Options of a select field that are only available while `when` holds for the row values. */
export type SelectConditionalOptions<TOption extends string = string> = {
  readonly options: readonly TOption[];
  readonly when: Exclude<FieldCondition, boolean>;
};

export type SelectFieldDef<TOptions extends readonly string[] = readonly string[]> = {
  readonly type: "select";
  readonly description?: string;
  readonly options: TOptions;
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly sortNulls?: SortNulls;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly default?: TOptions[number];
  readonly access?: FieldAccess;
  /** Renderer metadata: `"radio"` always renders the option set as a visible
   *  radio group, `"dropdown"` always renders the combobox. Omitted = the
   *  renderer's own heuristic picks (radio group for a few short labels,
   *  dropdown otherwise). A `"radio"` group with many or long labels wraps —
   *  the author owns that trade-off, the renderer does not override it. */
  readonly display?: "radio" | "dropdown";
  /** Status tone per option, shown as a toned badge with dot in lists and
   *  detail bands. Options without an entry keep the renderer's own
   *  value-based heuristic. */
  readonly optionTones?: { readonly [K in TOptions[number]]?: SelectOptionTone };
  /** Loads the options from this query (QN), labels shown verbatim: `{ rows: { value, label,
   *  description?, group?, default? }[] }`; description is a muted second line, group a heading.
   *  actionForm only: the first `default: true` row seeds an empty field like a prefill (not a
   *  change); set `submitPrefilled` to submit it unchanged. `options` must be empty when set.
   *  Only valid on configEdit/actionForm screen fields and config keys, not entity fields. */
  readonly optionsQuery?: string;
  /** Payload sent with every `optionsQuery` call. `{ field }` entries re-load the
   *  options when that sibling field changes. */
  readonly optionsQueryPayload?: OptionsQueryPayload;
  /** Marks static options as unavailable per tenant (e.g. by tier). Contract:
   *  `{ rows: { value: string; disabled?: boolean; hint?: string }[] }`. The renderer
   *  loads it (with `optionsQueryPayload` resolved like for `optionsQuery`, `{}` when
   *  absent) and merges it onto `options`: `disabled` disables the option, `hint` becomes
   *  its description. The currently stored value always stays enabled; unknown values
   *  are ignored. Static `options` stay authoritative, and the write path must enforce
   *  the same rule (see `withTierOptionGate`), the renderer only mirrors it. */
  readonly optionsAvailabilityQuery?: string;
  /** Options that are only available while `when` holds for the row values; options
   *  in no rule are always available. The write path enforces it, the renderer only
   *  filters. Only valid on entity fields. */
  readonly conditionalOptions?: readonly SelectConditionalOptions<TOptions[number]>[];
} & PiiAndFieldState;

// Several values from a fixed option list, rendered as a checkbox or
// multi-select control. Stored as a jsonb array of strings; every entry
// must be one of `options`.
//
// Use it instead of `select` when the user may pick more than one value at
// once (license classes, tags, languages, skills). Use it instead of
// `embedded` with booleans when the option list should not be hardcoded or
// has more than about 5 options, otherwise the embedded schema explodes.
//
// Ordering: the array keeps the caller's order (a jsonb array, not a set).
// The framework does not deduplicate on write; the validator will reject
// duplicates only once there is a need.
export type MultiSelectFieldDef<TOptions extends readonly string[] = readonly string[]> = {
  readonly type: "multiSelect";
  readonly description?: string;
  readonly options: TOptions;
  readonly required?: boolean;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  /** Default selection. Every entry must occur in `options` (boot validator). */
  readonly default?: readonly TOptions[number][];
  readonly access?: FieldAccess;
  /** Renderer metadata: `"checkboxes"` renders every option as a visible
   *  checkbox with a select-all toggle. Default (omitted) stays the combobox
   *  dropdown. */
  readonly display?: "checkboxes" | "dropdown";
  /** Renderer metadata: column count for the `"checkboxes"` grid at the widest
   *  breakpoint; narrow viewports always collapse to one column. Omitted =
   *  the renderer picks a sensible count. Ignored unless
   *  `display: "checkboxes"`. */
  readonly columns?: 1 | 2 | 3 | 4;
  /** Renderer metadata: how many grid rows stay visible before the
   *  `"checkboxes"` grid becomes scrollable. Omitted = the grid grows with its
   *  content and never scrolls. Ignored unless `display: "checkboxes"`. */
  readonly maxRows?: number;
  /** Query returning `{ rows: { value, disabled?, hint? }[] }`. The renderer hides
   *  options whose row has `disabled: true` unless the value is currently selected;
   *  `hint` is ignored. Static `options` stay authoritative and the write path must
   *  enforce the same rule, the renderer only mirrors it. Called with an empty payload. */
  readonly optionsAvailabilityQuery?: string;
} & PiiAndFieldState;

/**
 * Storage: `integer` flag decides the Postgres column type, not just Zod
 * validation. `integer: true` → `integer` column (32-bit, ~±2.1 billion),
 * write-boundary enforces `.int()`. Omitted/`false` (the default) →
 * `double precision` column — fractional values are accepted end to end.
 * Need exact decimal storage instead of a binary float (money-adjacent
 * math, no representation error)? Use `createDecimalField` (`numeric`).
 */
export type NumberFieldDef = {
  readonly type: "number";
  readonly description?: string;
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly sortNulls?: SortNulls;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly default?: number;
  readonly access?: FieldAccess;
  readonly min?: number;
  /** Upper bound at the write boundary (Zod `.max`). */
  readonly max?: number;
  /** `true` → `integer` column + `.int()` Zod validation. Omitted/`false` →
   *  `double precision` column, fractional values allowed. */
  readonly integer?: boolean;
  /** Display-only suffix: a static string, or a sibling field name whose
   *  value supplies it. Never converts the stored number. */
  readonly unit?: string | { readonly field: string };
  /** Thousands-grouping in the rendered display (Intl `useGrouping`).
   *  Default `true`. Set `false` for values that read wrong grouped (e.g. a
   *  model year: "2021", not "2.021"). Never affects the stored value. */
  readonly grouping?: boolean;
} & PiiAndFieldState;

/**
 * 64-bit integer field for audit counters, byte sizes, event IDs, and other
 * values that can exceed 2^31 (~2.1 billion). Stored as Postgres `bigint`,
 * with a JavaScript `number` round trip (`mode:"number"`, safe through 2^53
 * ≈ 9 PB and JSON-serializable). Values above 2^53 should use a `text` field
 * with a custom codec.
 *
 * Prefer this over `NumberFieldDef`'s 32-bit integer cap whenever a value can
 * physically exceed that limit: bytes, events, high-throughput counters, and
 * cumulative sums. Money has its own `MoneyFieldDef` with a currency column.
 */
export type BigIntFieldDef = {
  readonly type: "bigInt";
  readonly description?: string;
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly sortNulls?: SortNulls;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly default?: number;
  readonly access?: FieldAccess;
} & PiiAndFieldState;

/**
 * Exact decimal — Postgres `numeric(precision, scale)`. For values that need
 * fractional precision the integer `number` field (32-bit int) and `money`
 * field (BIGINT minor units + currency) can't hold: interest rates,
 * percentages, ratios, measurements.
 *
 * `precision` = total significant digits, `scale` = digits after the decimal
 * point (both required — no silent default that could truncate). pg returns
 * `numeric` as a string to preserve precision; the read-codec surfaces it as
 * a JS `number` (safe ≤ 2^53, same trade-off as `bigInt` mode:"number" — a
 * value past that boundary loses precision, so keep `precision - scale` ≤ 15).
 */
export type DecimalFieldDef = {
  readonly type: "decimal";
  readonly description?: string;
  readonly precision: number;
  readonly scale: number;
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly sortNulls?: SortNulls;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly default?: number;
  readonly access?: FieldAccess;
} & PiiAndFieldState;

/** Where a money field's currency comes from. `"tenant"` is the
 *  tenant-settings bundle's per-tenant currency (`tenant-settings:config:
 *  currency`); `"literal"` names a fixed ISO code and
 *  is checked against the app's `currencies` list at boot.
 *  Discriminated union so a `{ kind: "field", of }`
 *  variant (amount and currency-picker side by side) can still be added
 *  without a breaking change, once a multi-currency form actually exists. */
export type MoneyCurrencySource =
  | { readonly kind: "tenant" }
  | { readonly kind: "literal"; readonly code: string };

/** Qualified config key a `{ kind: "tenant" }` MoneyCurrencySource resolves
 *  against — the tenant-settings bundle's per-tenant currency. Lives here
 *  (client-safe) rather than framework/engine so renderer code can read it
 *  without a runtime-only import. */
export const TENANT_CURRENCY_CONFIG_KEY = "tenant-settings:config:currency";

export type MoneyFieldDef = {
  readonly type: "money";
  readonly description?: string;
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly sortNulls?: SortNulls;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
  /** Declares where this field's currency comes from for a currently-empty
   *  value in an entityEdit form. Undefined = unchanged existing behaviour
   *  (`entity.defaultCurrency ?? "EUR"`); a stored value always keeps its
   *  own currency regardless of this declaration. */
  readonly currency?: MoneyCurrencySource;
} & FieldStateConditions;

// Reference field — FK-style reference to another entity. Stored in a UUID
// column; the read side can optionally include the referenced row.
//
// `entity` accepts two forms:
//   - short ("customer") — same-feature reference, the default path;
//   - qualified ("users:user") — cross-feature, in the format
//     "<featureName>:<entityName>". The renderer builds the lookup query QN
//     against the specified feature (`users:query:user:list`).
//
// `labelField` optionally selects the referenced entity field displayed as the
// Select dropdown label. Default: "id". A human-readable field such as
// "name", "title", or "email" is recommended.
export type ReferenceFieldDef = {
  readonly type: "reference";
  readonly description?: string;
  readonly entity: string;
  readonly required?: boolean;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
  /** Field of the referenced entity displayed as the Select dropdown label.
   *  Default: "id". The boot validator ensures that the field exists on the
   *  referenced entity. */
  readonly labelField?: string;
  /** Multi-reference: the value is an array of UUIDs rather than a single UUID.
   *  Stored as a jsonb array of UUIDs; the UI renders a multi-select combobox
   *  with tags for the selected items. */
  readonly multiple?: boolean;
  /** Include a row in this entity's result set on a text-search hit against
   *  the referenced entity's `labelField`, instead of only matching the UUID
   *  column itself. Requires an explicit `labelField` — the boot
   *  validator rejects it otherwise, since the default "id" is a UUID column
   *  and ILIKE against it would crash at runtime. */
  readonly searchable?: true;
  /** Order a list by the referenced entity's `labelField` instead of by the raw
   *  UUID column. Requires an explicit, non-"id" `labelField` — the
   *  boot validator rejects it otherwise, since ordering by a UUID produces a
   *  sequence that looks meaningful to the user but is arbitrary. */
  readonly sortable?: true;
  readonly sortNulls?: SortNulls;
  /** Fill the picker from this query handler instead of the referenced
   *  entity's own list handler — for targets whose identity is
   *  composed from joined rows, where no single column of the referenced
   *  entity is a readable label. Fully-qualified QN
   *  ("<feature>:query:<short>"), boot-validated against the registered
   *  handlers; result contract `{ rows: { id, label }[] }`, called with
   *  `{ limit, search? }` like the default list handler, and with `{ limit, ids }`
   *  for stored values, which should answer exactly those rows. `id` rather than the
   *  `{ value, label }` of `DashboardFilterDefinition.optionsQuery`, because
   *  the stored value here IS the referenced row's id.
   *
   *  Additive to `labelField`, which keeps serving the paths a query handler
   *  cannot back: list cells, `searchable` and `sortable` all resolve to an
   *  SQL column on the referenced table.
   *
   *  The handler must return the row for an id that is already stored, even
   *  when it otherwise curates its result (say, to active records only) —
   *  the read-only display resolves a stored value against these rows and
   *  falls back to the raw id for one it does not find. */
  readonly optionsQuery?: string;
  /** tenant-handover opt-out: rows of THIS entity that point at a handed-over
   *  row through this field stay in the source tenant instead of travelling
   *  with it (or failing the claim with `entity_not_transferable`). The
   *  reference then deliberately crosses the tenant boundary after the
   *  handover. Use it for an entity that must not move with its host. */
  readonly handover?: "stay";
} & PiiAndFieldState;

// --- Currency ---

// Keep in sync with DEFAULT_CURRENCIES in ../field-helpers.ts.
export type DefaultCurrency =
  | "EUR"
  | "USD"
  | "GBP"
  | "CHF"
  | "JPY"
  | "SEK"
  | "NOK"
  | "DKK"
  | "PLN"
  | "CZK"
  | "CAD"
  | "AUD"
  | "NZD"
  | "CNY"
  | "INR";

// --- Embedded Object ---

type EmbeddedSubFieldBase = {
  readonly required?: boolean;
  readonly searchable?: boolean;
  readonly access?: FieldAccess;
} & FieldStateConditions;

/** `money` is a signed integer amount in minor units (cents); which currency
 *  it means is defined by the owning aggregate (a head-level field or tenant
 *  config), not per row. Unlike the top-level `money` field (BIGINT + currency
 *  column) the value lives in jsonb, so it must stay within ±(2^53 − 1).
 *
 *  `decimal` bounds a JSON number to `scale` fractional digits (0–15). `scale`
 *  is required — no silent default that could truncate — and there is no
 *  `precision`: jsonb has no numeric column behind it whose width `precision`
 *  could describe. */
export type EmbeddedSubFieldDef =
  | (EmbeddedSubFieldBase & {
      readonly type: "text" | "number" | "boolean" | "date" | "money" | "timestamp";
    })
  | (EmbeddedSubFieldBase & {
      readonly type: "decimal";
      readonly scale: number;
    })
  | (EmbeddedSubFieldBase & {
      readonly type: "select";
      readonly options: readonly string[];
      /** Same contract as `SelectFieldDef.display`; in a table cell the
       *  default stays a dropdown. */
      readonly display?: "radio" | "dropdown";
      readonly optionTones?: { readonly [option: string]: SelectOptionTone };
    })
  | (EmbeddedSubFieldBase & {
      readonly type: "reference";
      readonly entity: string;
      readonly labelField?: string;
      /** Same contract as `ReferenceFieldDef.optionsQuery`. */
      readonly optionsQuery?: string;
    })
  | (EmbeddedSubFieldBase & EmbeddedImagesSubFieldProps & { readonly type: "images" })
  | (EmbeddedSubFieldBase & EmbeddedFilesSubFieldProps & { readonly type: "files" });

export type EmbeddedFileSubFieldDef = Extract<EmbeddedSubFieldDef, { type: "images" | "files" }>;

export type EmbeddedTotalDef =
  | string
  | { readonly label: string; readonly from: readonly string[] };

export type EmbeddedFieldDef = {
  readonly type: "embedded";
  readonly description?: string;
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly schema: Readonly<Record<string, EmbeddedSubFieldDef>>;
  readonly access?: FieldAccess;
  /** A list of like-shaped objects instead of exactly one: the value is an
   *  array and every element is validated against `schema`. Storage stays
   *  jsonb, the column default becomes `[]` instead of `{}`. Built via
   *  `createEmbeddedListField()`.
   *
   *  Only for rows that come into being with their head and stay immutable
   *  with it (posting lines, invoice positions). A row with its own lifetime
   *  (own from/to dates, own history) belongs in its own entity referencing
   *  the head — an embedded array is rewritten whole on every change and has
   *  no per-row history. */
  readonly multiple?: boolean;
  /** Minimum row count for an embedded list. Only valid with `multiple: true`. */
  readonly minItems?: number;
  /** Maximum row count for an embedded list. Only valid with `multiple: true`. */
  readonly maxItems?: number;
  /** Renderer metadata: sub-field name → how to compute its cell from other
   *  sub-fields of the same row, rounded to that sub-field's declared
   *  precision. Only valid with `multiple: true`. */
  readonly derived?: Readonly<Record<string, EmbeddedDerivedCellDef>>;
  /** Renderer metadata: footer totals. A string is the sum of that numeric
   *  sub-field under the column label; an object shows the sum of all `from`
   *  sub-fields under its own i18n `label` (e.g. net, VAT, gross). Display
   *  only; the server derivation is unchanged. Only valid with
   *  `multiple: true`. */
  readonly totals?: readonly EmbeddedTotalDef[];
  /** Maps an embedded-list subfield name to a sibling top-level money field
   *  name — the sum of that subfield across all rows must equal the sibling
   *  field's amount. Validated both client- and server-side (schema-builder
   *  superRefine). Only meaningful with `multiple: true`. Compares against
   *  rounded `derived` cells, i.e. "sum-of-rounded" not "round-of-sum" —
   *  see the embedded-list totals-matching behavior. */
  readonly totalsMatch?: Readonly<Record<string, string>>;
} & PiiAndFieldState;

// Free-form jsonb — keys/shape NOT validated at write-time. Use for:
//   - Tenant-defined extension data (custom-fields-bundle uses this for
//     `customFields` on host-entities — keys are dynamic per fieldDefinition)
//   - Configuration-blobs with shape that evolves outside the entity field schema
//   - AI-inferred metadata where shape is provider-dependent
//
// Vs. embedded: embedded enforces a typed sub-schema; jsonb accepts any
// JSON-shaped object. Read-side both map to Postgres `jsonb`. Default `{}`
// + NOT NULL, identisch zu embedded.
export type JsonbFieldDef = {
  readonly type: "jsonb";
  readonly description?: string;
  /** `"array"`: the field holds a JSON array, so a row that never wrote it reads `[]` and writes
   *  take an array. Default `"object"` (`{}`, writes take a plain object). */
  readonly emptyValue?: JsonbEmptyValue;
  readonly sensitive?: boolean;
  /** A later run reads this field's value as an instruction — prompt, rule,
   *  template. Every create/update whose payload writes it requires agent.risk
   *  "high" on the directly-dispatched entry handler; a revert doesn't undo a
   *  run that already read the compromised value. See irreversible-operation-gate. */
  readonly readAsInstruction?: boolean;
  readonly access?: FieldAccess;
} & PiiAndFieldState;

export type JsonbEmptyValue = "object" | "array";

// Legacy `date` — a JavaScript Date object with ambiguous semantics
// (wall-clock time versus instant). For new fields, prefer:
//   - `timestamp` for a UTC instant ("when did this happen");
//   - `createLocatedTimestampField()` for appointments at a location
//     ("Pickup at 10:00 in Lisbon");
//   - `plainDate` for calendar dates without a time (for example, birthdays).
// See docs/plans/architecture/timezones.md.
export type DateFieldDef = {
  readonly type: "date";
  readonly description?: string;
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly sortNulls?: SortNulls;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
  /** Permitted date bounds as ISO `yyyy-mm-dd` (for example, a birth date
   *  cannot be in the future when `max` is today). The bounds constrain the
   *  picker and are enforced by the Zod schema on write. */
  readonly min?: string;
  readonly max?: string;
  /** Format/locale override for display and input parsing (for example,
   *  "de-DE"). Default: app locale. */
  readonly locale?: string;
} & PiiAndFieldState;

// UTC instant (`Temporal.Instant`) for events occurring at a specific moment
// without a location: createdAt, loginAt, actualPickupAt.
// JSON form: ISO UTC string "2026-04-18T10:00:00Z" via `.toJSON()`.
//
// With `locatedBy: "<name>Tz"`, the field forms a wall-clock/time-zone pair
// with the referenced tz field. The JSON form then has two fields ({ at, tz });
// the database is meant to store wall-clock time and the time zone and convert
// them transparently, through a DB wrapper planned for a later iteration.
//
// For new fields, prefer `createLocatedTimestampField()` — one atomic field
// instead of a loosely connected pair (see LocatedTimestampFieldDef).
export type TimestampFieldDef = {
  readonly type: "timestamp";
  readonly description?: string;
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly sortNulls?: SortNulls;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
  /**
   * Marker: this timestamp field represents wall-clock time at a location.
   * The value is the name of the accompanying tz field (IANA zone).
   *
   * Example: manual pair
   *   { pickupAt: { type: "timestamp", locatedBy: "pickupTz" }, pickupTz: { type: "tz" } }
   * — prefer `createLocatedTimestampField()` instead.
   */
  readonly locatedBy?: string;
  /** Permitted bounds as ISO datetime values. The picker is limited to day
   *  granularity; the Zod schema enforces the exact time bound on write. */
  readonly min?: string;
  readonly max?: string;
  /** Format/locale override for display and input parsing. Default: app
   *  locale. */
  readonly locale?: string;
} & PiiAndFieldState;

// IANA time-zone name (for example, "Europe/Berlin" or
// "America/Los_Angeles"). It is validated through
// `Intl.supportedValuesOf("timeZone")`. A dedicated field type preserves type
// safety, ensures TEXT-column storage, and gives the `locatedBy` marker an
// unambiguous target.
export type TzFieldDef = {
  readonly type: "tz";
  readonly description?: string;
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
} & PiiAndFieldState;

// Wall-clock appointment at a location as an atomic concept.
// One field in the schema definition, two database columns
// (`<name>_utc TIMESTAMPTZ` + `<name>_tz TEXT`), and three fields in the API
// object ({ at, tz, utc }). The Drizzle wrapper converts transparently: feature
// code sees the three-field object on read and writes { at, tz } on insert;
// `utc` is calculated.
//
// API form:
//   Write: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" }
//   Read:  { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon", utc: "2026-04-15T09:00:00Z" }
//
// The default view for `at` is wall-clock time at the location (`tz`). To show
// it in a user's local time, project `utc` separately with
// ctx.tz.fromInstantInZone(utc, userTz).
//
// Replaces the old `locatedTimestamp(name)` helper pattern of two separate
// pair fields with a single field type and automatic conversion.
export type LocatedTimestampFieldDef = {
  readonly type: "locatedTimestamp";
  readonly description?: string;
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly sortNulls?: SortNulls;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
  /** Permitted bounds as ISO datetime values (wall-clock time). The picker is
   *  limited to day granularity; the Zod schema enforces the exact time bound
   *  on write. */
  readonly min?: string;
  readonly max?: string;
  /** Format/locale override for display and input parsing. Default: app
   *  locale. */
  readonly locale?: string;
} & PiiAndFieldState;

export type FileFieldDef = {
  readonly type: "file";
  readonly description?: string;
  readonly required?: boolean;
  readonly maxSize?: string;
  /** Anonymous visitors may upload into this field as a pending upload (no entityId); the app
   *  binds the file itself. Default off. */
  readonly anonymousUpload?: boolean;
  readonly accept?: readonly string[];
  readonly access?: FieldAccess;
} & PiiAndFieldState;

export type ImageFieldDef = {
  readonly type: "image";
  readonly description?: string;
  readonly required?: boolean;
  readonly maxSize?: string;
  /** Anonymous visitors may upload into this field as a pending upload (no entityId); the app
   *  binds the file itself. Default off. */
  readonly anonymousUpload?: boolean;
  readonly accept?: readonly string[];
  /** Named derived versions of the uploaded image. The name is the only
   *  thing a caller may ask for — the spec lives here, never in a request,
   *  so nobody can drive arbitrary renders. Boot-validated. */
  readonly variants?: Readonly<Record<string, VariantSpec>>;
  /** Forwarded to the file input's `capture` attribute so a phone opens the
   *  camera instead of the file picker. */
  readonly capture?: "environment" | "user";
  readonly access?: FieldAccess;
} & PiiAndFieldState;

export type FilesFieldDef = {
  readonly type: "files";
  readonly description?: string;
  readonly maxSize?: string;
  /** Anonymous visitors may upload into this field as a pending upload (no entityId); the app
   *  binds the file itself. Default off. */
  readonly anonymousUpload?: boolean;
  readonly accept?: readonly string[];
  readonly maxCount?: number;
  /** `"list"` (default) shows the picked files as a list with a file picker; `"dropzone"` shows a
   *  drag-and-drop zone with one status row per file, a remove action per file and the field's
   *  `maxCount`/`accept`/`maxSize` as hints. The stored value is the same array of FileRef ids. */
  readonly display?: "list" | "dropzone";
  readonly access?: FieldAccess;
} & PiiAndFieldState;

export type ImagesFieldDef = {
  readonly type: "images";
  readonly description?: string;
  readonly maxSize?: string;
  /** Anonymous visitors may upload into this field as a pending upload (no entityId); the app
   *  binds the file itself. Default off. */
  readonly anonymousUpload?: boolean;
  readonly accept?: readonly string[];
  readonly maxCount?: number;
  /** `"list"` (default) shows the picked files as a list with a file picker; `"dropzone"` shows a
   *  drag-and-drop zone with one status row per file, a remove action per file and the field's
   *  `maxCount`/`accept`/`maxSize` as hints. The stored value is the same array of FileRef ids. */
  readonly display?: "list" | "dropzone";
  readonly variants?: Readonly<Record<string, VariantSpec>>;
  /** Forwarded to the file input's `capture` attribute so a phone opens the
   *  camera instead of the file picker. */
  readonly capture?: "environment" | "user";
  readonly access?: FieldAccess;
} & PiiAndFieldState;

export type FieldDefinition =
  | TextFieldDef
  | LongTextFieldDef
  | BooleanFieldDef
  | SelectFieldDef
  | MultiSelectFieldDef
  | NumberFieldDef
  | BigIntFieldDef
  | DecimalFieldDef
  | MoneyFieldDef
  | ReferenceFieldDef
  | EmbeddedFieldDef
  | JsonbFieldDef
  | DateFieldDef
  | TimestampFieldDef
  | TzFieldDef
  | LocatedTimestampFieldDef
  | FileFieldDef
  | ImageFieldDef
  | FilesFieldDef
  | ImagesFieldDef;

// Exhaustive catalogue of `FieldDefinition["type"]` values, derived from a
// `Record` so an added/removed union member fails to compile here instead of
// silently drifting out of sync with the runtime validator that consults
// this list (feature-ast's pattern-change-schema). Plain array, not a Set —
// same rationale as NO_WIDGET_FIELD_TYPES (guard-types-class-free.test.ts).
const FIELD_TYPE_NAME_FLAGS: Record<FieldDefinition["type"], true> = {
  text: true,
  longText: true,
  boolean: true,
  select: true,
  multiSelect: true,
  number: true,
  bigInt: true,
  decimal: true,
  money: true,
  reference: true,
  embedded: true,
  jsonb: true,
  date: true,
  timestamp: true,
  tz: true,
  locatedTimestamp: true,
  file: true,
  image: true,
  files: true,
  images: true,
};

function isFieldTypeName(name: string): name is FieldDefinition["type"] {
  return Object.hasOwn(FIELD_TYPE_NAME_FLAGS, name);
}

export const FIELD_TYPE_NAMES: readonly FieldDefinition["type"][] =
  Object.keys(FIELD_TYPE_NAME_FLAGS).filter(isFieldTypeName);

/** FieldDefinition as an entity-less inline form screen (actionForm,
 *  secretMint) may declare it: a `money` field there has no entity to borrow
 *  `defaultCurrency` from, so it must name its own currency source, or the
 *  form seeds a bare `0` that the handler's zod schema then rejects
 *  . Entity fields keep the optional `currency` —
 *  `entity.defaultCurrency` is already boot-enforced for them. */
export type FormFieldDefinition =
  | Exclude<FieldDefinition, MoneyFieldDef>
  | (MoneyFieldDef & { readonly currency: MoneyCurrencySource });

// Union of all field variants that represent uploaded files. They share
// `maxSize` and `accept`, which is what upload validation cares about.
export type AnyFileFieldDef = FileFieldDef | ImageFieldDef | FilesFieldDef | ImagesFieldDef;

// Field types with no bound, editable widget on the auto-wired entityEdit
// path (render-field.tsx renders a read-only banner instead) — shared by
// the boot validator (packages/framework/src/engine/boot-validator/screens-forms.ts)
// and the client-side required-field check (packages/renderer/src/app/form-schema.ts).
// Embedded LIST fields (`multiple: true`) are the one exception — they get
// their own EmbeddedListField grid widget — callers must check that
// separately, this array alone doesn't distinguish plain embedded from embedded lists.
// A plain array, not a Set: kumiko-types stays free of module-scope runtime
// identity (guard-types-class-free.test.ts) since a consumer may resolve two
// copies of this package.
export const NO_WIDGET_FIELD_TYPES: readonly FieldDefinition["type"][] = ["jsonb", "embedded"];

// --- Entity ---

// --- State Transitions ---

export type TransitionMap = Readonly<Record<string, readonly string[]>>;

/** Composite index on an entity. Columns are referenced by field name
 *  (camelCase). `buildEntityTable` maps them to snake_case column names and
 *  names the index by convention:
 *
 *    <table>_<col1>_<col2>_idx          (non-unique)
 *    <table>_<col1>_<col2>_unique       (unique)
 *
 *  A `name` override is allowed to avoid migration churn when refactoring
 *  existing code.
 *
 *  Single-column indexes over `tenantId` are redundant because
 *  `buildEntityTable` creates them automatically; boot validation warns about
 *  them unless `{ unique: true }`, which expresses a semantic 1:1 constraint
 *  rather than a performance hint. */
export type EntityIndexDef = {
  readonly columns: readonly [string, ...string[]];
  readonly unique?: boolean;
  readonly name?: string;
  /**
   * Optional SQL fragment for a partial index — `CREATE [UNIQUE] INDEX
   * ... WHERE <condition>`. This is PostgreSQL's pattern for indexing only
   * rows that meet specified conditions; a typical example is export-job
   * idempotency: `UNIQUE(userId) WHERE status IN ('pending', 'running')`.
   *
   * Callers build the fragment with the drizzle-orm `sql\`...\`` tagged
   * template. table-builder.ts emits `.where(def.where)` on the Drizzle
   * IndexBuilder. It applies to both unique and non-unique indexes; a
   * non-unique partial index can target a status subset instead of the full
   * table.
   */
  readonly where?: unknown;
};

// An entity text field needs exactly one personal-data stance, and the
// createTextField / createLongTextField factories always resolve one. Screen
// form fields reuse TextFieldDef without a stance, so only entity fields narrow.
export type ResolvedPiiStance =
  | { readonly pii: true }
  | { readonly userOwned: NonNullable<ResolvedPiiFlags["userOwned"]> }
  | { readonly tenantOwned: true }
  | { readonly recordOwned: true }
  | { readonly allowPlaintext: string }
  | { readonly subjectRef: true };

export type EntityTextFieldDef = TextFieldDef & ResolvedPiiStance;
export type EntityLongTextFieldDef = LongTextFieldDef & ResolvedPiiStance;

export type EntityFieldDefinition =
  | Exclude<FieldDefinition, TextFieldDef | LongTextFieldDef>
  | EntityTextFieldDef
  | EntityLongTextFieldDef;

export type FieldsMap = Readonly<Record<string, EntityFieldDefinition>>;

export type { ParentRefDef, ReadGateDef } from "./entity-row-visibility.ts";

export type EntityEventMigration = {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly transform: (
    fields: Readonly<Record<string, unknown>>,
    ctx: EventUpcastCtx,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
};

export type EntityDefinition<
  F extends FieldsMap = FieldsMap,
  T extends EntityTenancy = EntityTenancy,
> = {
  readonly table?: string;
  readonly fields: F;
  readonly softDelete?: boolean;
  /** "tenant" (default): auto-filtered by every db accessor. "global": shared across
   *  tenants, reachable only via `db.global(table)`. Not named `scope` — config keys use that. */
  readonly tenancy?: T;
  /** This aggregate's event stream lives on SYSTEM_TENANT_ID rather than the
   *  creator's tenant. Opt-in per entity (NOT inherited from r.systemScope()):
   *  only for genuinely tenant-independent aggregates like `user`. The first
   *  event (create) is what's routed; updates resolve the stream tenant upstream. */
  readonly systemStream?: boolean;
  /** Schema version stamped on every lifecycle event (default 1, integer 1..999). Bump it together with a step in `eventMigrations`. */
  readonly eventVersion?: number;
  /** One step per version, fromVersion → fromVersion+1. Transforms run on row-shaped field records; the record may be partial, touch only keys that are present.
   *  `pii` and `encrypted` fields arrive as stored ciphertext bound to their field name (AAD): pass them through under the same key, never rename or derive from them, or the value can no longer be decrypted. */
  readonly eventMigrations?: readonly EntityEventMigration[];
  readonly searchWeight?: number;
  readonly defaultCurrency?: string;
  /** Rows whose stored state meets this condition are read-only: every executor
   *  update and delete on them is rejected with a 409 (`errors.recordLocked`), whatever
   *  handler or job calls it. The write that sets the lock passes, because the check reads the
   *  state before the write. Forget is exempt, and so are framework system-user writes that name
   *  a `writePurpose` (retention, erasure); a system user without one is blocked like anyone else.
   *  A call site that must unlock a row passes `{ unsafeSkipLockGuard: true }` to that one executor call. The entityEdit
   *  screen shows such rows in view mode. The condition field must be a plaintext text, select,
   *  boolean, number or reference field. */
  readonly lockedWhen?: FieldCondition;
  /** Allowed state transitions per field. Boot validates against select options. */
  readonly transitions?: Readonly<Record<string, TransitionMap>>;
  /** Composite indexes over multiple fields. Single-column foreign-key indexes
   *  and the tenant_id index are still created automatically by
   *  `buildEntityTable`; this list is only for custom indexes explicitly
   *  declared by the author (for example,
   *  `{ unique: true, columns: ["key", "tenantId", "userId"] }`). */
  readonly indexes?: readonly EntityIndexDef[];
  /**
   * Entity primary-key type.
   * - `"serial"` (default): bigserial integer — faster and more compact, suitable
   *   for classic CRUD entities.
   * - `"uuid"`: UUID with a `gen_random_uuid()` default — required for entities
   *   whose `id` travels as a foreign-key value in multi-tenant contexts (for
   *   example, `tenant.id` is the `tenantId`). Also required for event-sourced
   *   aggregates because events are grouped by UUID.
   */
  readonly idType?: "serial" | "uuid";
  /**
   * Row-level ownership rules (H.2). read runs as WHERE-predicate on list/
   * detail/queryProjection, scoping which rows the caller sees. write runs
   * pre-save on create/update/delete, scoping which rows the caller may
   * modify (Straddle-safe, multi-role atomic — see engine/ownership.ts).
   *
   * Keys are role names; rules use the `from()` helper or `{ where }`
   * escape hatch. Entity-level ownership is AND-ed with tenant isolation —
   * a user's tenant filter still applies first.
   */
  readonly access?: {
    readonly read?: OwnershipMap;
    readonly write?: OwnershipMap;
  };
  /**
   * Join-row carrier reference. Rows of this entity hang off a host row named
   * by two of the entity's own fields. Both paths derive one visibility gate
   * from this single declaration: write handlers deny with NotFoundError, and
   * list/detail filter in SQL against the host entity's own read path (tenant
   * scope, soft-delete, `access.read` ownership). A host type that names no
   * registered entity is denied.
   */
  readonly parentRef?: ParentRefDef;
  /**
   * Declarative read gate for rows readable only through other rows (a link to a visible host,
   * a file whose owner is readable). AND-ed with `access.read` and `parentRef` in list, detail,
   * count, aggregate, live signals and the writers' readability check. Without the request-time
   * registry the gate denies every non-system caller.
   */
  readonly readGate?: ReadGateDef;
  /**
   * Default retention policy for this entity. Tenant administrators can
   *   override it through compliance profiles and tenant overrides.
   *   The cleanup job applies these strategies:
   *
   *   - "hardDelete" → physically remove the row after `keepFor`
   *   - "softDelete" → set `deletedAt = now()` (with the core-soft-delete feature)
   *   - "anonymize"  → overwrite fields with an `anonymize` function while the
   *                    row remains
   *   - "blockDelete" → the cleanup job skips the row; user forget instead
   *                    triggers anonymization. Accounting records, mandates,
   *                    and patient records.
   *
   * See docs/plans/features/core-data-retention.md.
   */
  readonly retention?: RetentionDef;
  /**
   * Read-time computed fields, keyed by name. Not stored, not a DB column,
   * not writable — appended to each row by the list/detail query handler and
   * nameable as a column in a declarative `entityList`. See DerivedFieldDef.
   */
  readonly derivedFields?: DerivedFieldsMap;
  /** Named work-queue rules keyed by id, selected via `namedFilter`; function-valued, never in the client schema. */
  readonly namedFilters?: Readonly<Record<string, NamedListFilterDef>>;
  /** Optional free-text semantics for the AI agent manifest — see TextFieldDef.description. */
  readonly description?: string;
  /** Opts the rows into `tenant-handover`, a grant-legitimated move from an anonymous tenant to the
   *  signed-up account's tenant. An entity reachable from a transfer's root (the root, or one whose
   *  `parentRef` names the root's type) without `transferable: true` fails the whole transfer with
   *  a named error instead of silently leaving its rows behind. */
  readonly transferable?: boolean;
  /** Attached files are readable only through the record's detail query: the files feature's
   *  privilegedRoles do not bypass it, the uploader check stays. */
  readonly attachedFileAccess?: "record-only";
};
