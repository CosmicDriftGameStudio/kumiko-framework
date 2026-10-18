import { normalizeEventPiiSubject } from "@cosmicdrift/kumiko-types/handlers";
import { ZodObject, type ZodType } from "zod";
import { qn, toKebab } from "./qualified-name.js";
import type {
  EventDef,
  EventPiiFields,
  EventPiiStance,
  QualifiedEventName,
} from "./types/index.js";

// A payload field that still holds null/undefined after parsing — the case
// where an event-PII owner field yields no subject at append time (fw#2776).
// A `.default(...)` accepts undefined but parses to a value, so it is not
// absentable.
function isAbsentable(field: ZodType): boolean {
  return [null, undefined].some((candidate) => {
    const parsed = field.safeParse(candidate);
    return parsed.success && (parsed.data === null || parsed.data === undefined);
  });
}

const NON_STRING_SCHEMA_TYPES: ReadonlySet<string> = new Set([
  "number",
  "int",
  "boolean",
  "bigint",
  "date",
  "object",
  "array",
]);

// An owner id is resolved through "non-empty string or absent" at append time,
// so a schema that can never yield a string would make every append throw in
// prod. Wrappers (optional/nullable/default/...) are looked through.
function neverYieldsString(field: ZodType): boolean {
  let current: ZodType = field;
  for (;;) {
    const def: { readonly type: string; readonly innerType?: ZodType } = current._zod.def;
    if (def.innerType === undefined) return NON_STRING_SCHEMA_TYPES.has(def.type);
    current = def.innerType;
  }
}

function assertOwnerFieldYieldsPresentString(args: {
  readonly featureName: string;
  readonly eventName: string;
  readonly field: string;
  readonly ownerField: string;
  readonly owner: ZodType;
}): void {
  const { featureName, eventName, field, ownerField, owner } = args;
  if (neverYieldsString(owner)) {
    throw new Error(
      `[Feature ${featureName}] defineEvent("${eventName}"): piiFields."${field}" is owned by "${ownerField}", whose payload schema is not a string — the subject id must be a non-empty string, so every append would fail. ` +
        `Use a string owner field, or declare whenAbsent ("tenant" | "self" | "plaintext").`,
    );
  }
  if (isAbsentable(owner)) {
    throw new Error(
      `[Feature ${featureName}] defineEvent("${eventName}"): piiFields."${field}" is owned by "${ownerField}", which the payload schema allows to be null/undefined. ` +
        `Declare what happens then: { personal: { of: "${ownerField}", whenAbsent: "tenant" } } encrypts under the envelope tenant key, ` +
        `whenAbsent: "self" under the event's own record key, whenAbsent: "plaintext" acknowledges that the value ships unencrypted and cannot be crypto-shredded (fw#2776).`,
    );
  }
}

// piiFields misconfiguration is a boot-time error, not a silent
// plaintext leak: both the pii field and its owner field must exist
// on the payload schema (checkable when the schema is a ZodObject).
function validateEventPiiFields(
  featureName: string,
  eventName: string,
  schema: ZodType,
  piiFields: EventPiiFields,
): void {
  const shape = schema instanceof ZodObject ? schema.shape : undefined;
  for (const [field, spec] of Object.entries(piiFields)) {
    const normalized = normalizeEventPiiSubject(spec);
    // Only the user form names an owner field — tenant/self subjects come
    // from the write-time envelope (tenantId / aggregateType+aggregateId),
    // so there is no owner-field existence or self-reference check for them.
    if (normalized.kind !== "user") {
      if (shape && !(field in shape)) {
        throw new Error(
          `[Feature ${featureName}] defineEvent("${eventName}"): piiFields references "${field}" which is not a field of the payload schema.`,
        );
      }
      continue;
    }
    if (field === normalized.ownerField) {
      throw new Error(
        `[Feature ${featureName}] defineEvent("${eventName}"): piiFields."${field}" cannot use itself as the owner field — the subject id is a plaintext pseudonymous fk, the pii field is the value it owns.`,
      );
    }
    if (normalized.ownerField === "id") {
      throw new Error(
        `[Feature ${featureName}] defineEvent("${eventName}"): piiFields."${field}" uses owner field "id" — on entities \`of: "id"\` means record-owned, but on events it would encrypt under a phantom user key that a forget never reaches. Use \`personal: "self"\` for a record-owned event field.`,
      );
    }
    for (const required of [field, normalized.ownerField]) {
      if (shape && !(required in shape)) {
        throw new Error(
          `[Feature ${featureName}] defineEvent("${eventName}"): piiFields references "${required}" which is not a field of the payload schema.`,
        );
      }
    }
    const owner = shape?.[normalized.ownerField];
    if (normalized.whenAbsent === undefined && owner !== undefined) {
      assertOwnerFieldYieldsPresentString({
        featureName,
        eventName,
        field,
        ownerField: normalized.ownerField,
        owner,
      });
    }
  }
}

export type CreateEventDefOptions<TFeature extends string, TInner extends string, TPayload> = {
  readonly feature: TFeature;
  readonly name: TInner;
  readonly schema: ZodType<TPayload>;
  readonly version?: number;
  readonly piiFields: EventPiiStance;
};

/**
 * The EventDef that `r.defineEvent` returns, built outside a feature's setup
 * callback, so a module can hand the definition to `emitEvent` without the
 * feature instance. Registration still goes through `r.defineEvent`.
 */
export function createEventDef<
  const TFeature extends string,
  const TInner extends string,
  TPayload,
>(
  options: CreateEventDefOptions<TFeature, TInner, TPayload>,
): EventDef<TPayload, QualifiedEventName<TFeature, TInner>> {
  const { feature, name: eventName, schema } = options;
  // Fail-closed PII stance gate (fw#2558) — runs before anything else so
  // an untyped JS consumer (no compiler to stop it) still can't register
  // an event without declaring whether its payload carries personal data.
  const missingStanceError = () =>
    new Error(
      `[Feature ${feature}] defineEvent("${eventName}") must declare an explicit PII stance. Pass { piiFields: { <payloadField>: { personal: { of: "<userIdField>" } } } } for payload fields owned by a user (or { personal: "tenant" } / { personal: "self" } for tenant- or record-scoped subjects), or { piiFields: "none" } when the payload holds none.`,
    );
  if (options.piiFields === undefined) throw missingStanceError();
  const piiFields = options.piiFields;
  // @cast-boundary runtime-guard — an untyped JS caller can hand
  // anything through `piiFields` (including null), so re-check the
  // shape before trusting it as EventPiiStance: `typeof null === "object"`
  // would otherwise pass through to Object.keys(null) below and throw a
  // raw TypeError instead of this guidance message.
  if (piiFields !== "none" && (typeof piiFields !== "object" || piiFields === null)) {
    throw missingStanceError();
  }
  if (piiFields !== "none" && Object.keys(piiFields).length === 0) {
    throw new Error(
      `[Feature ${feature}] defineEvent("${eventName}"): piiFields: {} is not a stance — use piiFields: "none" to declare the payload holds no personal data.`,
    );
  }
  if (piiFields !== "none") validateEventPiiFields(feature, eventName, schema, piiFields);
  const version = options.version ?? 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(
      `[Feature ${feature}] defineEvent("${eventName}"): version must be a positive integer, got ${String(version)}`,
    );
  }
  // @cast-boundary engine-bridge — runtime-string mirrors the
  // template-literal-type via QualifiedEventName + toKebab. Both
  // sides are tested (CamelToKebab type-tests + scan-events kebab
  // tests), so the cast is a contract, not a typing-loss.
  const qualified = qn(toKebab(feature), "event", toKebab(eventName)) as QualifiedEventName<
    TFeature,
    TInner
  >;
  return { name: qualified, schema, version, piiFields };
}
