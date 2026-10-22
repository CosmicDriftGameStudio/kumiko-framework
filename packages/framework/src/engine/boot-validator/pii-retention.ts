import { createFallbackLogger } from "../../logging/utils.ts";
import type { EntityDefinition, FieldDefinition, ResolvedPiiFlags } from "../types/fields.ts";
import type { FeatureDefinition } from "../types/index.ts";
import {
  PII_DIRECT_NAME_HINTS,
  PII_USER_OWNED_NAME_HINTS,
  PII_USER_REFERENCE_NAME_HINTS,
} from "./entity-handler.ts";

const log = createFallbackLogger("kumiko:boot");

// Framework-managed timestamp fields may be used as retention.reference
// even when they are not declared in entity.fields.
const FRAMEWORK_TIMESTAMP_FIELDS: ReadonlySet<string> = new Set([
  "createdAt",
  "updatedAt",
  "lastSeenAt",
  "deletedAt",
]);

// Allowed format for retention.keepFor: a number followed by a suffix (h/d/w/m/y).
// The cleanup job performs the actual parsing; the boot validator only checks
// the format so typos ("30days") become visible before the first cleanup run.
const KEEP_FOR_PATTERN = /^\d+[hdwmy]$/;

const FILE_FIELD_TYPES: ReadonlySet<FieldDefinition["type"]> = new Set([
  "file",
  "image",
  "files",
  "images",
]);

// Excludes subjectRef: its `personal: "ref"` union member structurally
// forbids `anonymize` (packages/types/src/fields.ts).
function hasAnonymizableSubjectField(annot: ResolvedPiiFlags): boolean {
  return Boolean(annot.pii || annot.userOwned || annot.tenantOwned || annot.recordOwned);
}

export function entityHasAnonymizableSubjectField(fields: EntityDefinition["fields"]): boolean {
  return Object.values(fields).some(
    (f) => hasAnonymizableSubjectField(f as ResolvedPiiFlags), // @cast-boundary schema-walk
  );
}

function ownerFieldNamesReferencedByPersonalOf(
  fieldsByName: EntityDefinition["fields"],
): ReadonlySet<string> {
  const ownerFieldNames = new Set<string>();
  for (const field of Object.values(fieldsByName)) {
    const ownerFieldName = (field as ResolvedPiiFlags).userOwned?.ownerField; // @cast-boundary schema-walk
    if (typeof ownerFieldName === "string") ownerFieldNames.add(ownerFieldName);
  }
  return ownerFieldNames;
}

const WRITE_ONLY_FORBIDDEN_FLAGS = [
  "default",
  "searchable",
  "sortable",
  "filterable",
  "lookupable",
] as const;

function validateWriteOnlyField(input: FieldRuleInput): void {
  const { field } = input;
  const where = fieldLocation(input);
  if (field.type === "embedded") {
    for (const [subName, subField] of Object.entries(field.schema)) {
      if ("writeOnly" in subField && subField.writeOnly === true) {
        // @cast-boundary schema-walk
        throw new Error(
          `${where} declares writeOnly on embedded sub-field "${subName}" — writeOnly is only supported on top-level text fields. Remove writeOnly from the sub-field or declare it on a top-level text field.`,
        );
      }
    }
    // skip: embedded fields carry no writeOnly of their own; sub-fields are checked above
    return;
  }
  const flags = field as { readonly writeOnly?: boolean } & Record<string, unknown>; // @cast-boundary schema-walk
  // skip: only writeOnly fields have constraints to validate
  if (flags.writeOnly !== true) return;
  if (field.type !== "text") {
    throw new Error(
      `${where} declares { writeOnly: true } but has type "${field.type}" — writeOnly only applies to text fields. Use a text field or remove writeOnly.`,
    );
  }
  if (field.sensitive !== true) {
    throw new Error(
      `${where} declares { writeOnly: true } without { sensitive: true } — add find: "secret" (ciphertext at rest, stripped from event echoes).`,
    );
  }
  for (const flag of WRITE_ONLY_FORBIDDEN_FLAGS) {
    const value = flags[flag];
    if (value !== undefined && value !== false) {
      throw new Error(
        `${where} combines { writeOnly: true } with { ${flag} } — a value that is never returned cannot be defaulted, searched, sorted, filtered or looked up. Remove either writeOnly or the conflicting flag.`,
      );
    }
  }
}

// A personal jsonb field is stored as a ciphertext JSON string scalar, so
// anything that reads inside the column (index, filter, sort, search, jsonb
// operators/merges such as the custom-fields column) sees only ciphertext.
const JSONB_PERSONAL_FORBIDDEN_FLAGS = [
  "sortable",
  "filterable",
  "searchable",
  "lookupable",
] as const;
const CUSTOM_FIELDS_COLUMN = "customFields";

function validatePersonalJsonbField(input: FieldRuleInput): void {
  const { entity, fieldName, field } = input;
  // skip: only personal jsonb fields are stored as a ciphertext scalar
  if (field.type !== "jsonb" || input.subjectAnnotationCount === 0) return;
  const where = fieldLocation(input);
  const reason =
    "a personal jsonb field is stored as a ciphertext string, so nothing inside it can be indexed, filtered, sorted, searched or merged";
  const flags = field as Record<string, unknown>; // @cast-boundary schema-walk
  for (const flag of JSONB_PERSONAL_FORBIDDEN_FLAGS) {
    if (flags[flag] !== undefined && flags[flag] !== false) {
      throw new Error(
        `${where} combines a personal annotation on a jsonb field with { ${flag} } — ${reason}. Remove the ${flag} flag or the personal annotation.`,
      );
    }
  }
  const index = entity.indexes?.find((def) => def.columns.includes(fieldName));
  if (index) {
    throw new Error(
      `${where} is a personal jsonb field used in an entity index — ${reason}. Drop the index or the personal annotation.`,
    );
  }
  if (fieldName === CUSTOM_FIELDS_COLUMN) {
    throw new Error(
      `${where} is the custom-fields jsonb column — its values are merged and searched per key, which ciphertext cannot support. Drop the personal annotation.`,
    );
  }
}

// --- PII / Subject-Key Annotations + Retention validation ---
//
// Four classes of checks:
//
// 1. Mutual exclusion: each field may have only ONE subject annotation
//    (pii / userOwned / tenantOwned). Multiple annotations are semantically
//    contradictory because each field belongs to exactly one subject key.
//
// 2. Reference integrity: userOwned.ownerField must refer to an existing
//    reference field that should target the user entity. This catches typos
//    and refactors that removed a field during boot instead of at encryption.
//
// 3. Heuristic warnings: field names that typically contain PII
//    (email, name, phone, body, etc.) without an annotation produce a boot
//    warning. `{ personal: false, reason: "<reason>" }` suppresses it and
//    records the reason in the audit.
//
// 4. Retention integrity: retention.reference, when set, must refer to an
//    existing field or a framework timestamp. retention.strategy="blockDelete"
//    without anonymizable fields is ineffective because user forget cannot
//    remove anything, so it produces a warning.
//
// Encryption and decryption are handled elsewhere; this validation runs early
// so schema drift is detected during boot.
export function validatePiiAndRetention(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    validateFieldAnnotations(feature.name, entityName, entity);
    validateEntityRetention(feature.name, entityName, entity);
  }
}

// ResolvedPiiFlags and the storage flags are type-level optional. On field defs
// not extended via "& ResolvedPiiFlags" (Boolean, Money, Reference, Embedded),
// property access returns undefined at runtime; TS compile-time validation
// already rejected that case elsewhere, so reading through this view is safe.
type PiiCheckedFieldFlags = ResolvedPiiFlags & {
  readonly sensitive?: boolean;
  readonly encrypted?: boolean;
  readonly searchable?: boolean;
  readonly sortable?: boolean;
};

type FieldRuleInput = {
  readonly featureName: string;
  readonly entityName: string;
  readonly entity: EntityDefinition;
  readonly fieldName: string;
  readonly field: FieldDefinition;
  readonly flags: PiiCheckedFieldFlags;
  readonly subjectAnnotationCount: number;
  readonly personalOfOwnerFieldNames: ReadonlySet<string>;
};

// Order matters: the first failing rule decides the boot error, and warnings
// are emitted in this order.
const FIELD_RULES: readonly ((input: FieldRuleInput) => void)[] = [
  rejectMultipleSubjectAnnotations,
  rejectTextWithoutPersonalStance,
  rejectInvalidLookupable,
  rejectSensitiveWithoutCiphertextAtRest,
  validateWriteOnlyField,
  rejectCiphertextSortOrSensitiveSearch,
  validatePersonalJsonbField,
  validatePersonalOfOwner,
  warnOnUnannotatedPersonalName,
];

function validateFieldAnnotations(
  featureName: string,
  entityName: string,
  entity: EntityDefinition,
): void {
  const personalOfOwnerFieldNames = ownerFieldNamesReferencedByPersonalOf(entity.fields);
  for (const [fieldName, field] of Object.entries(entity.fields)) {
    const flags = field as PiiCheckedFieldFlags; // @cast-boundary schema-walk
    const input: FieldRuleInput = {
      featureName,
      entityName,
      entity,
      fieldName,
      field,
      flags,
      subjectAnnotationCount: countSubjectAnnotations(flags),
      personalOfOwnerFieldNames,
    };
    for (const rule of FIELD_RULES) rule(input);
  }
}

function countSubjectAnnotations(flags: ResolvedPiiFlags): number {
  return [flags.pii, flags.userOwned, flags.tenantOwned, flags.recordOwned].filter(Boolean).length;
}

function fieldLocation(input: FieldRuleInput): string {
  return `[Feature ${input.featureName}] Field "${input.fieldName}" on entity "${input.entityName}"`;
}

function rejectMultipleSubjectAnnotations(input: FieldRuleInput): void {
  if (input.subjectAnnotationCount > 1) {
    throw new Error(
      `${fieldLocation(input)} has multiple subject-key annotations (personal: "self" / "tenant" / { of: "<field>" }). Pick one — each field belongs to exactly one subject.`,
    );
  }
}

function rejectTextWithoutPersonalStance(input: FieldRuleInput): void {
  const { field, flags } = input;
  if (
    (field.type === "text" || field.type === "longText") &&
    input.subjectAnnotationCount === 0 &&
    !flags.allowPlaintext &&
    !flags.subjectRef
  ) {
    throw new Error(
      `${fieldLocation(input)} (type "${field.type}") declares no personal stance. Build it with createTextField / createLongTextField and { personal: "self" | "tenant" | "ref" | { of: "<ownerField>" } | false }; false additionally needs { reason: "..." } stating why the value is not personal data.`,
    );
  }
}

// lookupable: only text fields with a subject annotation are supported. Without
// a subject, the value remains plaintext, so a blind index would be a
// second deterministic copy without any benefit.
function rejectInvalidLookupable(input: FieldRuleInput): void {
  // skip: only lookupable fields carry a blind index to validate
  if (input.flags.lookupable !== true) return;
  if (input.field.type !== "text") {
    throw new Error(
      `${fieldLocation(input)} declares find: "exact" (or "fuzzy") but has type "${input.field.type}" — blind-index equality lookups only apply to text fields. Use a text field or set find: "none".`,
    );
  }
  if (input.subjectAnnotationCount === 0) {
    throw new Error(
      `${fieldLocation(input)} declares find: "exact" (or "fuzzy") without a subject annotation (personal: "self" / "tenant" / { of: "<field>" }). Plaintext fields don't need a blind index — add personal or set find: "none".`,
    );
  }
}

// Sensitive fields are stored as table ciphertext in the event log; without
// ciphertext at rest, appending the event would write plaintext to the
// immutable history.
function rejectSensitiveWithoutCiphertextAtRest(input: FieldRuleInput): void {
  const { flags } = input;
  if (flags.sensitive === true && input.subjectAnnotationCount === 0 && flags.encrypted !== true) {
    throw new Error(
      `${fieldLocation(input)} declares { sensitive: true } without ciphertext-at-rest. Since #967 the event log stores sensitive fields as table ciphertext — add a subject annotation (personal: "self" / "tenant" / { of: "<field>" }) or { encrypted: true }.`,
    );
  }
}

// Sorting reads the projection column — that stays ciphertext, so
// sortable + subject annotation stays a boot-fail. searchable is allowed:
// the search consumer decrypts into the derived index and forget purges
// those docs (see createSearchEventConsumer). sensitive + searchable stays
// forbidden (never searchable).
function rejectCiphertextSortOrSensitiveSearch(input: FieldRuleInput): void {
  const { flags } = input;
  if (input.subjectAnnotationCount > 0 && flags.sortable === true) {
    throw new Error(
      `${fieldLocation(input)} combines a subject-key annotation with { sortable: true } — sorting reads the projection column, which is ciphertext at rest. For equality lookups use find: "exact"; drop sortable or keep the field plaintext (personal: false).`,
    );
  }
  if (flags.sensitive === true && flags.searchable === true) {
    throw new Error(
      `${fieldLocation(input)} combines { sensitive: true } with { searchable: true } — sensitive means ciphertext at rest, never searchable, stripped from event echoes — authorized readers can still read it back (passwords, tokens, tax IDs). Subject-annotated identity fields may be searchable (#1610); sensitive fields may not. To never return the value at all, add { writeOnly: true }.`,
    );
  }
}

function validatePersonalOfOwner(input: FieldRuleInput): void {
  const personalOf = input.flags.userOwned;
  // skip: only personal: { of } fields reference an owner field
  if (!personalOf) return;
  const ownerName = personalOf.ownerField;
  if (!ownerName || typeof ownerName !== "string") {
    throw new Error(
      `${fieldLocation(input)} has personal: { of: ... } without an owner field name. Pass the name of the owner field: personal: { of: "<ownerField>" }.`,
    );
  }
  const ownerField = requireOwnerField(input, ownerName);
  rejectOwnerWithoutRowFallback(input, ownerName, ownerField, personalOf);
  warnOnNonUserOwnerReference(input, ownerName, ownerField);
}

type PersonalOfOwnerField = Extract<FieldDefinition, { readonly type: "reference" | "text" }>;

function requireOwnerField(input: FieldRuleInput, ownerName: string): PersonalOfOwnerField {
  const fieldsByName = input.entity.fields;
  const ownerField = fieldsByName[ownerName];
  if (!ownerField) {
    const known = Object.keys(fieldsByName).sort().join(", ");
    throw new Error(
      `${fieldLocation(input)} references personal.of "${ownerName}" but no such field exists. Known fields: ${known}`,
    );
  }
  // Text is accepted alongside reference: the ES-framework carries
  // user ids as plain text columns throughout the bundled features
  // (user-session.userId, invitation.invitedBy) — there is no
  // relational FK to point a reference at. Self-referencing
  // ownerField (the field's own value IS the owner id) rides on this.
  if (ownerField.type !== "reference" && ownerField.type !== "text") {
    throw new Error(
      `[Feature ${input.featureName}] personal.of "${ownerName}" on entity "${input.entityName}" must be a reference or text (userId) field, got type "${ownerField.type}"`,
    );
  }
  return ownerField;
}

function rejectOwnerWithoutRowFallback(
  input: FieldRuleInput,
  ownerName: string,
  ownerField: PersonalOfOwnerField,
  personalOf: NonNullable<ResolvedPiiFlags["userOwned"]>,
): void {
  const { whenAbsent } = personalOf;
  if (whenAbsent !== undefined && whenAbsent !== "tenant" && whenAbsent !== "self") {
    throw new Error(
      `${fieldLocation(input)} declares personal.whenAbsent "${String(whenAbsent)}" — entity fields only support whenAbsent: "tenant" or "self" (no plaintext fallback for stored PII). Remove whenAbsent or set it to "tenant" (tenant key) or "self" (the row's own record key).`,
    );
  }
  if (ownerField.required !== true && whenAbsent === undefined) {
    throw new Error(
      `${fieldLocation(input)} is personal: { of: "${ownerName}" }, but "${ownerName}" is not required — rows without an owner would fail to encrypt (SubjectResolutionError, HTTP 500) on update, delete and forget. Declare { personal: { of: "${ownerName}", whenAbsent: "tenant" } } to encrypt those rows under the tenant key, whenAbsent: "self" to encrypt them under the row's own record key (shreddable per record), or make "${ownerName}" required: true. Entity fields have no plaintext fallback (fw#3654).`,
    );
  }
}

// Custom subject entities (such as HR employees or patients) are allowed but
// should be an intentional choice.
function warnOnNonUserOwnerReference(
  input: FieldRuleInput,
  ownerName: string,
  ownerField: PersonalOfOwnerField,
): void {
  // skip: text owner fields carry a user id by convention, there is no target to check
  if (ownerField.type !== "reference") return;
  const refTarget = ownerField.entity;
  const targetEntity = refTarget.includes(":") ? refTarget.split(":")[1] : refTarget;
  if (targetEntity !== "user") {
    log.warn(
      `[Feature ${input.featureName}] personal.of "${ownerName}" on entity "${input.entityName}" targets reference "${refTarget}" — typically should be a user reference. If intentional (custom subject-entity like employee/patient), ignore.`,
    );
  }
}

type UnannotatedNameWarning = {
  readonly applies: (input: FieldRuleInput, lowerName: string) => boolean;
  readonly message: (input: FieldRuleInput) => string;
};

// First match wins. Business data with person-like names (for example,
// company.legalName) can produce false positives; authors can suppress them
// with { personal: false, reason: "is_business_data" }.
const UNANNOTATED_NAME_WARNINGS: readonly UnannotatedNameWarning[] = [
  {
    applies: (input) => FILE_FIELD_TYPES.has(input.field.type),
    message: (input) =>
      `[Feature ${input.featureName}] File field "${input.fieldName}" on entity "${input.entityName}" has no personal annotation. A forget with strategy "delete" then only severs the uploader link and keeps the binary. If the file holds personal data, mark it { personal: "self" } or { personal: { of: "<ownerField>" } }. If it is business data, set { personal: false, reason: "is_business_data" } to silence.`,
  },
  {
    applies: (_input, lowerName) => PII_DIRECT_NAME_HINTS.has(lowerName),
    message: (input) =>
      `${fieldLocation(input)} has a PII-typical name but no personal annotation. If this is PII, mark it { personal: "self", find: ... }. If business data, set { personal: false, reason: "is_business_data" } to silence.`,
  },
  {
    applies: (_input, lowerName) => PII_USER_OWNED_NAME_HINTS.has(lowerName),
    message: (input) =>
      `${fieldLocation(input)} has a user-content-typical name but no personal annotation. If this contains user-generated content, mark it { personal: { of: "<authorIdField>" }, find: ... }. If business data, set { personal: false, reason: "..." } to silence.`,
  },
  {
    applies: (input, lowerName) =>
      PII_USER_REFERENCE_NAME_HINTS.has(lowerName) &&
      !input.flags.subjectRef &&
      !input.personalOfOwnerFieldNames.has(input.fieldName),
    message: (input) =>
      `${fieldLocation(input)} has a user-reference-typical name but no personal annotation — a foreign key into \`user\` carries Art.17 obligations even with no annotated content on the entity. Mark it { personal: "ref" } AND register r.useExtension(EXT_USER_DATA, "${input.entityName}", …) for Art.17 coverage — this warning is the only boot-time check for that, registering the hook is not enforced. Or { personal: { of: "${input.fieldName}" } } on the field it owns. If business data, set { personal: false, reason: "..." } to silence.`,
  },
];

function warnOnUnannotatedPersonalName(input: FieldRuleInput): void {
  // skip: an annotation or an explicit plaintext reason already states the field's stance
  if (input.subjectAnnotationCount > 0 || input.flags.allowPlaintext) return;
  const lowerName = input.fieldName.toLowerCase();
  const warning = UNANNOTATED_NAME_WARNINGS.find((candidate) =>
    candidate.applies(input, lowerName),
  );
  if (warning) log.warn(warning.message(input));
}

type RetentionRuleInput = {
  readonly featureName: string;
  readonly entityName: string;
  readonly fieldsByName: EntityDefinition["fields"];
  readonly retention: NonNullable<EntityDefinition["retention"]>;
};

const RETENTION_RULES: readonly ((input: RetentionRuleInput) => void)[] = [
  warnOnInvalidKeepFor,
  rejectUnknownRetentionReference,
  warnOnBlockDeleteWithoutAnonymize,
];

function validateEntityRetention(
  featureName: string,
  entityName: string,
  entity: EntityDefinition,
): void {
  const { retention } = entity;
  // skip: entities without a retention policy have nothing to validate
  if (!retention) return;
  const input: RetentionRuleInput = {
    featureName,
    entityName,
    fieldsByName: entity.fields,
    retention,
  };
  for (const rule of RETENTION_RULES) rule(input);
}

function warnOnInvalidKeepFor({ featureName, entityName, retention }: RetentionRuleInput): void {
  if (!KEEP_FOR_PATTERN.test(retention.keepFor)) {
    log.warn(
      `[Feature ${featureName}] Entity "${entityName}" retention.keepFor="${retention.keepFor}" has an invalid format. Expected: <number><h|d|w|m|y> (e.g. "30d", "10y", "6m"). The cleanup job cannot parse anything else; fix keepFor.`,
    );
  }
}

function rejectUnknownRetentionReference(input: RetentionRuleInput): void {
  const { featureName, entityName, fieldsByName } = input;
  const refName = input.retention.reference;
  // skip: no explicit retention.reference to resolve
  if (refName === undefined) return;
  if (!fieldsByName[refName] && !FRAMEWORK_TIMESTAMP_FIELDS.has(refName)) {
    const known = Object.keys(fieldsByName).sort().join(", ");
    const framework = [...FRAMEWORK_TIMESTAMP_FIELDS].sort().join(", ");
    throw new Error(
      `[Feature ${featureName}] Entity "${entityName}" retention.reference "${refName}" does not exist. Known fields: ${known} — framework-managed timestamps also accepted: ${framework}`,
    );
  }
}

// blockDelete with no field that can carry `anonymize` is fine;
// subjectRef-only entities are covered by the V3 EXT_USER_DATA guard instead.
function warnOnBlockDeleteWithoutAnonymize(input: RetentionRuleInput): void {
  const { featureName, entityName, fieldsByName } = input;
  // skip: only blockDelete relies on anonymize once keepFor expires
  if (input.retention.strategy !== "blockDelete") return;
  const hasAnonymize = Object.values(fieldsByName).some((f) => {
    const a = f as ResolvedPiiFlags; // @cast-boundary schema-walk
    return Boolean(a.anonymize);
  });
  if (entityHasAnonymizableSubjectField(fieldsByName) && !hasAnonymize) {
    log.warn(
      `[Feature ${featureName}] Entity "${entityName}" retention.strategy="blockDelete" but no field has an anonymize-function. Once keepFor expires, the data-retention cron anonymizes nothing and the row keeps its PII. Add { anonymize: () => null } or () => "[ANONYMIZED]" to PII fields.`,
    );
  }
}
