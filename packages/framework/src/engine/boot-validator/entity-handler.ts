import type {
  EmbeddedFieldDef,
  EntityDefinition,
  FieldAccess,
  FieldDefinition,
} from "@cosmicdrift/kumiko-types/fields";
import type { QueryHandlerDef, RateLimitPer } from "@cosmicdrift/kumiko-types/handlers";
import { declaredRateLimitOptions, isRateLimitDisabled } from "@cosmicdrift/kumiko-types/handlers";
import { ZodObject } from "zod";
import { holdsFileRefs } from "../../files/file-field-slots.ts";
import { access as accessPresets } from "../config-helpers.ts";
import { parseRefTarget } from "../parse-ref-target.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { HANDLER_ACCESS_RULES } from "./entity-handler-access-rules.ts";
import { ENTITY_REFERENCE_EMBEDDED_RULES } from "./entity-reference-embedded-rules.ts";
import { ENTITY_STRUCTURE_RULES } from "./entity-structure-rules.ts";
import { FIELD_CONDITION_RULES } from "./field-conditions-rules.ts";
import {
  validateBeforeTransactionWhenNested,
  validatePerCommandTransaction,
} from "./transaction-phases.ts";

export const FILE_FIELD_TYPES = new Set(["file", "image", "files", "images"]);

// Field names that typically contain PII. Without a `pii: true` /
// `userOwned` / `tenantOwned` / `allowPlaintext` marker → boot warning.
// Compare in lower case for case-insensitive matching (displayName vs displayname).
//
// Deliberately NOT included:
//   - `name` alone — too many business contexts (product.name,
//     tenant.name, role.name) are not PII. Personal names are detected
//     through displayName / firstName / lastName / fullName.
export const PII_DIRECT_NAME_HINTS: ReadonlySet<string> = new Set([
  "email",
  "phone",
  "phonenumber",
  "mobile",
  "address",
  "street",
  "postalcode",
  "zipcode",
  "zip",
  "city",
  "displayname",
  "firstname",
  "lastname",
  "fullname",
  "birthday",
  "birthdate",
  "dateofbirth",
  "dob",
  "ssn",
  "taxid",
  "vatid",
  "passport",
  "iban",
  "bic",
]);

// Field names that typically contain user-generated content —
// User-Forget must encrypt these with the author subject key.
export const PII_USER_OWNED_NAME_HINTS: ReadonlySet<string> = new Set([
  "body",
  "text",
  "content",
  "message",
  "comment",
  "description",
  "note",
  "notes",
]);

// Field names that typically hold a FK into the `user` entity — carry no
// content of their own, but the subject-data obligation attaches to the
// link, not to annotated content. Without this hint, an entity with no
// userOwned-content field stays invisible to the GDPR-hook-coverage guard
// even though `authorId` is still personal data.
export const PII_USER_REFERENCE_NAME_HINTS: ReadonlySet<string> = new Set([
  "authorid",
  "assigneeid",
  "assigneeuserid",
  "ownerid",
  "createdby",
  "createdbyid",
  "createdbyuserid",
  "updatedby",
  "updatedbyid",
  "updatedbyuserid",
  "invitedby",
  "approvedby",
  "reviewedby",
  "uploadedby",
  "assignedto",
  "reportedby",
  "memberid",
]);

// --- Extension preSave wiring validation ---

/** Extensions with preSave must target an entity that has mapped write handlers. */
export function validateExtensionPreSaveWiring(features: readonly FeatureDefinition[]): void {
  const extensionsWithPreSave = new Set<string>();
  for (const f of features) {
    for (const [extName, def] of Object.entries(f.registrarExtensions ?? {})) {
      if (def.hooks?.preSave) extensionsWithPreSave.add(extName);
    }
  }
  // skip: no extensions declare preSave hooks — nothing to validate
  if (extensionsWithPreSave.size === 0) return;

  const entitiesWithMappedWrites = new Set<string>();
  for (const f of features) {
    for (const [handlerName, entityName] of Object.entries(f.handlerEntityMappings ?? {})) {
      if (handlerName in (f.writeHandlers ?? {})) {
        entitiesWithMappedWrites.add(entityName);
      }
    }
  }

  for (const f of features) {
    for (const usage of f.extensionUsages) {
      if (!extensionsWithPreSave.has(usage.extensionName)) continue;
      if (!entitiesWithMappedWrites.has(usage.entityName)) {
        throw bootRuleError(HANDLER_ACCESS_RULES.presaveWithoutMappedWrite, {
          message:
            `Feature "${f.name}" uses extension "${usage.extensionName}" with preSave on entity "${usage.entityName}" ` +
            `but no write handler is entity-mapped to "${usage.entityName}". ` +
            `Use create/update/delete on a matching entity or name the handler "entity:verb".`,
        });
      }
    }
  }
}

// --- Handler access validation ---

// Rate-limit modes that bucket per user.id. Anonymous endpoints would put
// every unauthenticated caller into a single shared bucket (id="anonymous"),
// turning the rate-limit into a global tap any caller can drain. Boot-fail
// before the misconfiguration ships.
const USER_BUCKETED_RATE_LIMIT_PER: ReadonlySet<string> = new Set(["user", "user+handler"]);

// Every handler must declare access. Missing access is treated as default-deny
// at runtime, but we fail at boot to turn an easy-to-miss security regression
// into a loud configuration error.
export function validateHandlerAccess(feature: FeatureDefinition): void {
  const kinds = [
    { kind: "write" as const, label: "Write", handlers: feature.writeHandlers },
    { kind: "query" as const, label: "Query", handlers: feature.queryHandlers },
    { kind: "stream" as const, label: "Stream", handlers: feature.streamHandlers },
  ];
  for (const { kind, label, handlers } of kinds) {
    for (const [name, handler] of Object.entries(handlers)) {
      if (!handler.access) {
        throw bootRuleError(HANDLER_ACCESS_RULES.accessMissing, {
          message:
            `${label} handler "${feature.name}:${kind}:${name}" is missing an access rule. ` +
            `Set { roles: [...] } for role-based access, or { openToAll: { reason: "..." } } for any authenticated user.`,
        });
      }
      validateNoAllRoleInHandlerAccess(feature.name, kind, name, handler.access);
      validateRateLimitBucketList(feature.name, kind, name, handler.rateLimit);
      validateAnonymousRateLimit(feature.name, kind, name, handler.access, handler.rateLimit);
      validateRateLimitDisabledReason(feature.name, kind, name, handler.rateLimit);
    }
  }
  for (const [name, handler] of Object.entries(feature.writeHandlers)) {
    validateTenantlessAnonymous(feature.name, name, handler);
    validateAdditionalRateLimits(feature.name, name, handler);
    validateRateLimitCost(feature.name, name, handler);
    validatePerCommandTransaction(feature.name, name, handler);
    validateBeforeTransactionWhenNested(feature.name, name, handler);
  }
}

const IP_BUCKETED_RATE_LIMIT_PER: ReadonlySet<string> = new Set(["ip", "ip+handler"]);

// Payload buckets only complement the per-IP bucket: an anonymous caller
// who rotates IPs is what they exist for, and without the IP bucket a single
// IP could still burn through unlimited distinct addresses.
export function validateAdditionalRateLimits(
  featureName: string,
  handlerName: string,
  handler: FeatureDefinition["writeHandlers"][string],
): void {
  const { additionalRateLimits } = handler;
  // skip: handler declares no payload buckets
  if (additionalRateLimits === undefined) return;
  const where = `write handler "${featureName}:write:${handlerName}" declares additionalRateLimits`;
  if (additionalRateLimits.length === 0) {
    throw bootRuleError(HANDLER_ACCESS_RULES.additionalBucketsEmpty, {
      message: `${where} as an empty array — declare at least one bucket or drop the option.`,
    });
  }
  validateAnonymousHasIpBucket(where, handler);
  const shape = handler.schema instanceof ZodObject ? handler.schema.shape : undefined;
  const seenFields = new Set<string>();
  for (const entry of additionalRateLimits) {
    validatePayloadBucket(where, shape, entry);
    const field = entry.per.payloadField;
    // Two entries on one field hash the same value into the same Redis key, so enforceAll
    // would deduct only one of the costs.
    if (seenFields.has(field)) {
      throw bootRuleError(HANDLER_ACCESS_RULES.additionalPayloadFieldDuplicate, {
        message:
          `${where} with payloadField "${field}" more than once — both entries would share one ` +
          `Redis bucket per value. Keep one entry per payloadField.`,
      });
    }
    seenFields.add(field);
  }
}

function validateAnonymousHasIpBucket(
  where: string,
  handler: FeatureDefinition["writeHandlers"][string],
): void {
  const { access, rateLimit } = handler;
  const allowsAnonymous = "roles" in access && access.roles.includes("anonymous");
  // skip: only anonymous callers need an ip bucket
  if (!allowsAnonymous) return;
  const hasIpBucket = declaredRateLimitOptions(rateLimit).some((option) =>
    IP_BUCKETED_RATE_LIMIT_PER.has(option.per),
  );
  if (!hasIpBucket) {
    throw bootRuleError(HANDLER_ACCESS_RULES.additionalWithoutIpBucket, {
      message:
        `${where} and allows anonymous callers, but has no ip-keyed rateLimit ` +
        `(per: "ip" or "ip+handler", not disabled). Payload buckets only complement the IP bucket. Set rateLimit: { per: "ip", ... } on the handler.`,
    });
  }
}

function validatePayloadBucket(
  where: string,
  shape: Record<string, unknown> | undefined,
  entry: NonNullable<FeatureDefinition["writeHandlers"][string]["additionalRateLimits"]>[number],
): void {
  const field = entry.per.payloadField;
  if (shape === undefined || !Object.hasOwn(shape, field)) {
    throw bootRuleError(HANDLER_ACCESS_RULES.payloadFieldUnknown, {
      message:
        `${where} with payloadField "${field}", which is not a field of the handler's schema ` +
        `(the schema must be a Zod object containing it).`,
    });
  }
  if (!Number.isInteger(entry.limit) || entry.limit <= 0) {
    throw bootRuleError(HANDLER_ACCESS_RULES.payloadLimitInvalid, {
      message: `${where} for "${field}" with limit ${entry.limit} — must be a positive integer.`,
    });
  }
  if (!Number.isInteger(entry.windowSeconds) || entry.windowSeconds <= 0) {
    throw bootRuleError(HANDLER_ACCESS_RULES.payloadWindowInvalid, {
      message: `${where} for "${field}" with windowSeconds ${entry.windowSeconds} — must be a positive integer.`,
    });
  }
}

const IP_SCOPED_RATE_LIMIT_PER: readonly RateLimitPer[] = ["ip", "ip+handler"];

export function validateTenantlessAnonymous(
  featureName: string,
  handlerName: string,
  handler: FeatureDefinition["writeHandlers"][string],
): void {
  // skip: handler does not opt into tenantless anonymous calls
  if (!handler.tenantlessAnonymous) return;
  const where = `write handler "${featureName}:write:${handlerName}" declares tenantlessAnonymous`;
  const { access } = handler;
  const isAnonymousOnly =
    "roles" in access && access.roles.length === 1 && access.roles[0] === "anonymous";
  if (!isAnonymousOnly) {
    throw bootRuleError(HANDLER_ACCESS_RULES.tenantlessAnonymousAccess, {
      message:
        `${where} but its access is not exactly { roles: ["anonymous"] } — a tenantless request ` +
        `carries no principal beyond the anonymous visitor. Set access to { roles: ["anonymous"] } or remove tenantlessAnonymous.`,
    });
  }
  const options = declaredRateLimitOptions(handler.rateLimit);
  if (options.length === 0) {
    throw bootRuleError(HANDLER_ACCESS_RULES.tenantlessAnonymousWithoutRateLimit, {
      message:
        `${where} without a rateLimit — a handler reachable on hosts that resolve no tenant ` +
        `needs a real upper bound (rateLimit: { per: "ip", ... }); { disabled: true } does not count.`,
    });
  }
  for (const { per } of options) {
    if (IP_SCOPED_RATE_LIMIT_PER.includes(per)) continue;
    throw bootRuleError(HANDLER_ACCESS_RULES.tenantlessAnonymousRateLimitPer, {
      message:
        `${where} with rateLimit.per "${per}" — every anonymous visitor shares the same ` +
        `tenant/user bucket, so one caller could exhaust it for all. Use ${IP_SCOPED_RATE_LIMIT_PER.map((allowed) => `"${allowed}"`).join(" or ")}.`,
    });
  }
}

export function validateRateLimitCost(
  featureName: string,
  handlerName: string,
  handler: FeatureDefinition["writeHandlers"][string],
): void {
  // skip: no payload-derived cost declared
  if (!handler.rateLimitCost) return;
  if (handler.rateLimit === undefined || isRateLimitDisabled(handler.rateLimit)) {
    throw bootRuleError(HANDLER_ACCESS_RULES.costWithoutRateLimit, {
      message:
        `write handler "${featureName}:write:${handlerName}" declares rateLimitCost without an active rateLimit — ` +
        `the cost is booked on the rateLimit buckets, so declare rateLimit or drop rateLimitCost.`,
    });
  }
  const isAnonymous = "roles" in handler.access && handler.access.roles.includes("anonymous");
  const hasIpBucket = declaredRateLimitOptions(handler.rateLimit).some(({ per }) =>
    IP_SCOPED_RATE_LIMIT_PER.includes(per),
  );
  if (isAnonymous || hasIpBucket) {
    throw bootRuleError(HANDLER_ACCESS_RULES.costOnAnonymousHandler, {
      message:
        `write handler "${featureName}:write:${handlerName}" declares rateLimitCost on an anonymous or ip-limited handler — ` +
        `rateLimitCost books after the parse, so such a handler would lose its pre-parse protection against junk floods. ` +
        `Bulk handlers are authenticated: use a user/tenant bucket and drop "anonymous", or drop rateLimitCost.`,
    });
  }
}

export function validateRateLimitDisabledReason(
  featureName: string,
  kind: "write" | "query" | "stream",
  handlerName: string,
  rateLimit: FeatureDefinition["writeHandlers"][string]["rateLimit"],
): void {
  // skip: rate limit isn't disabled, so no reason is required
  if (!isRateLimitDisabled(rateLimit)) return;
  if (rateLimit.reason.trim().length === 0) {
    throw bootRuleError(HANDLER_ACCESS_RULES.disabledWithoutReason, {
      message:
        `${kind} handler "${featureName}:${kind}:${handlerName}" declares rateLimit: { disabled: true } ` +
        `without a reason. Provide { disabled: true, reason: "..." } explaining why this handler must not ` +
        `be rate-limited.`,
    });
  }
}

export function validateRateLimitBucketList(
  featureName: string,
  kind: "write" | "query" | "stream",
  handlerName: string,
  rateLimit: FeatureDefinition["writeHandlers"][string]["rateLimit"],
): void {
  // skip: a single option or a disabled declaration has no bucket list to check
  if (!Array.isArray(rateLimit)) return;
  const where = `${kind} handler "${featureName}:${kind}:${handlerName}"`;
  if (rateLimit.length === 0) {
    throw bootRuleError(HANDLER_ACCESS_RULES.bucketListEmpty, {
      message: `${where} declares rateLimit as an empty array — declare at least one bucket or drop the option.`,
    });
  }
  const seen = new Set<RateLimitPer>();
  for (const { per } of rateLimit) {
    if (seen.has(per)) {
      throw bootRuleError(HANDLER_ACCESS_RULES.bucketPerDuplicate, {
        message:
          `${where} declares rateLimit with per "${per}" more than once — both entries would share one ` +
          `Redis bucket with conflicting limits. Keep one entry per "per".`,
      });
    }
    seen.add(per);
  }
}

// No session ever carries the role "all" — `roles: ["all"]` is unreachable dead config, not a wildcard.
export function validateNoAllRoleInHandlerAccess(
  featureName: string,
  kind: "write" | "query" | "stream",
  handlerName: string,
  access: NonNullable<FeatureDefinition["writeHandlers"][string]["access"]>,
): void {
  // skip: openToAll has no roles list to check
  if (!("roles" in access)) return;
  // skip: no "all" in the roles list, nothing unreachable to report
  if (!accessPresets.all.some((role) => access.roles.includes(role))) return;
  throw bootRuleError(HANDLER_ACCESS_RULES.accessAllRole, {
    message:
      `${kind} handler "${featureName}:${kind}:${handlerName}" declares access: { roles: ["all"] } — ` +
      `no session ever carries the role "all", so this handler is unreachable by any caller. ` +
      `Use access: { roles: ["anonymous"] } plus rateLimit: { per: "ip", ... } (or "ip+handler") ` +
      `for unauthenticated callers, or access: { openToAll: { reason: "..." } } for any signed-in user.`,
  });
}

export function validateAnonymousRateLimit(
  featureName: string,
  kind: "write" | "query" | "stream",
  handlerName: string,
  access: NonNullable<FeatureDefinition["writeHandlers"][string]["access"]>,
  rateLimit: FeatureDefinition["writeHandlers"][string]["rateLimit"],
): void {
  // skip: openToAll handlers don't allow anonymous (hasAccess rejects), so
  // the user-bucket footgun doesn't apply
  if (!("roles" in access)) return;
  // skip: handler doesn't list anonymous, regular role-rate-limit is fine
  if (!access.roles.includes("anonymous")) return;
  // skip: disabled declarations carry no `.per` to bucket on
  if (isRateLimitDisabled(rateLimit)) return;
  const options = declaredRateLimitOptions(rateLimit);
  if (options.length === 0) {
    throw bootRuleError(HANDLER_ACCESS_RULES.anonymousWithoutRateLimit, {
      message:
        `${kind} handler "${featureName}:${kind}:${handlerName}" allows anonymous callers but declares no ` +
        `rateLimit — an anonymous, internet-facing endpoint needs an upper bound. Set rateLimit: ` +
        `{ per: "ip", limit: ..., windowSeconds: ... }, or the documented exception ` +
        `rateLimit: { disabled: true, reason: "..." }.`,
    });
  }
  for (const { per } of options) {
    // skip: this bucket is keyed on something safe (ip / tenant)
    if (!USER_BUCKETED_RATE_LIMIT_PER.has(per)) continue;
    throw bootRuleError(HANDLER_ACCESS_RULES.anonymousUserBucket, {
      message:
        `${kind} handler "${featureName}:${kind}:${handlerName}" allows anonymous callers but uses ` +
        `rateLimit.per="${per}" — every anonymous request shares user.id="anonymous", ` +
        `so this bucket would be a single global tap any caller could drain. ` +
        `Use rateLimit.per="ip" or "ip+handler" for anonymous endpoints.`,
    });
  }
}

// --- MultiStreamProjection delivery invariant ---
//
// `delivery: "per-instance"` with a `table` is a semantic trap:
// N dispatcher instances would write the same INSERT/UPDATE rows in parallel
// (races / duplicates), and a rebuild would affect only one row in
// kumiko_event_consumers (the SHARED_INSTANCE_SENTINEL row),
// while live cursors reside in per-instance rows → cursor divergence.
//
// The invariant is: per-instance consumers are side-effect-only (SSE,
// in-memory cache invalidation). Materializing a table requires
// shared delivery — it is exactly-once globally and gives the rebuild
// a single cursor to reset.
export function validateMultiStreamProjections(feature: FeatureDefinition): void {
  for (const [name, msp] of Object.entries(feature.multiStreamProjections)) {
    if (msp.delivery === "per-instance" && msp.table !== undefined) {
      throw bootRuleError(HANDLER_ACCESS_RULES.perInstanceWithTable, {
        message:
          `[Feature ${feature.name}] MultiStreamProjection "${name}" has delivery="per-instance" AND a backing table — ` +
          `that combination would make every dispatcher-instance write the same rows (duplicate INSERTs), and rebuild would reset only the shared cursor while live cursors live per-instance (cursor divergence). ` +
          `Use delivery="shared" (default) for table-materializing projections, or drop the table for side-effect-only consumers (SSE, in-memory caches).`,
      });
    }
  }
}

// --- Located-timestamp validation ---
//
// When a field with `type: "timestamp"` has a `locatedBy` marker, the
// referenced field must exist in the same entity AND have type `tz`.
// Otherwise neither the DB wrapper nor the JSON serializer knows which TZ
// belongs to the wall clock → silent data loss when reading in another
// server TZ.
//
// Manual construction is the most common source of conflicts:
//   { foo: { type: "timestamp", locatedBy: "fooTz" } }
// without declaring the `fooTz` field. `createLocatedTimestampField()`
// instead creates ONE field of type "locatedTimestamp" — using it avoids
// this validator.
export function validateLocatedTimestamps(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const fields = entity.fields;
    for (const [fieldName, field] of Object.entries(fields)) {
      if (field.type !== "timestamp" || field.locatedBy === undefined) continue;
      const referenced = fields[field.locatedBy];
      if (!referenced) {
        throw bootRuleError(ENTITY_STRUCTURE_RULES.locatedByMissingField, {
          message:
            `Feature "${feature.name}", entity "${entityName}": field "${fieldName}" has ` +
            `locatedBy: "${field.locatedBy}" but no field with that name exists in the entity. ` +
            `Either declare the tz-field, or use createLocatedTimestampField() ` +
            `to create a single located-timestamp field instead.`,
        });
      }
      if (referenced.type !== "tz") {
        throw bootRuleError(ENTITY_STRUCTURE_RULES.locatedByNotTz, {
          message:
            `Feature "${feature.name}", entity "${entityName}": field "${fieldName}" has ` +
            `locatedBy: "${field.locatedBy}" but that field is type "${referenced.type}", ` +
            `expected "tz". The locatedBy marker must point to a tz-field (IANA-zone slot).`,
        });
      }
    }
  }
}

// --- Entity-index validation ---
//
// entity.indexes declares composite/unique indexes over multiple field
// columns. Common errors include misspelled field names, an empty column
// list, and an index on a field for which the DB has no column (file/image
// in the multi-value variant). Catch these at boot, long before drizzle-kit
// fails during the generate run.
//
// A `tenantId`-only index is redundant because buildEntityTable creates
// that index automatically. Composite forms remain allowed
// (`["tenantId", "key"]` is useful); only the tenantId-only single-column
// form is rejected.
export function validateEntityIndexes(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    if (!entity.indexes) continue;
    const fieldNames = new Set(Object.keys(entity.fields));
    for (const [idx, def] of entity.indexes.entries()) {
      const where = `Feature "${feature.name}", entity "${entityName}", indexes[${idx}]`;
      if (def.columns.length === 0) {
        throw bootRuleError(ENTITY_STRUCTURE_RULES.indexColumnsEmpty, {
          message: `${where}: empty columns list. An index needs at least one column.`,
        });
      }
      for (const col of def.columns) {
        if (col === "tenantId" || col === "id" || col === "version") continue; // base columns
        if (!fieldNames.has(col)) {
          throw bootRuleError(ENTITY_STRUCTURE_RULES.indexUnknownColumn, {
            message:
              `${where}: column "${col}" does not match any field in the entity. ` +
              `Available fields: ${[...fieldNames].join(", ")}.`,
          });
        }
        const field = entity.fields[col];
        if (
          field &&
          (field.type === "files" ||
            field.type === "images" ||
            (field.type === "reference" && field.multiple === true))
        ) {
          throw bootRuleError(ENTITY_STRUCTURE_RULES.indexMultiValueColumn, {
            message:
              `${where}: column "${col}" is a multi-value field (${field.type}) — ` +
              `a jsonb array cannot be indexed as a column. Use a single-value field or remove from the index.`,
          });
        }
        if (field && field.type === "longText") {
          // longText semantically means "potentially-megabytes content" — a
          // BTREE index on a 1-MB column is a performance disaster
          // (PG would need to dereference TOAST pages for every
          // index lookup). This is consistent with the type-level decision
          // that longText has no sortable/searchable/filterable flags. Anyone
          // who truly needs indexing should use `text` with the
          // corresponding scaling trade-offs.
          throw bootRuleError(ENTITY_STRUCTURE_RULES.indexLongTextColumn, {
            message:
              `${where}: column "${col}" is a longText field — these cannot be indexed. ` +
              `Use \`text\` if you need indexing, or rely on the SearchAdapter (Meilisearch) for full-text search on long content.`,
          });
        }
      }
      // A UNIQUE constraint on tenantId is semantically meaningful (1:1 tenant→entity)
      // and NOT redundant — buildEntityTable's automatic index is only a
      // performance hint, not a constraint. Only the tenantId-only,
      // single-column, non-unique form is rejected.
      if (def.columns.length === 1 && def.columns[0] === "tenantId" && !def.unique) {
        throw bootRuleError(ENTITY_STRUCTURE_RULES.indexTenantIdOnly, {
          message:
            `${where}: single-column index on "tenantId" is redundant — ` +
            `buildEntityTable always creates one automatically. Remove this entry.`,
        });
      }
      // AES-GCM's random-IV ciphertext is never equal to itself across two
      // writes of the same plaintext, so a unique index on an encrypted
      // column can never detect a real duplicate.
      if (def.unique) {
        for (const col of def.columns) {
          const field = entity.fields[col];
          if (field && (field.type === "text" || field.type === "longText") && field.encrypted) {
            throw bootRuleError(ENTITY_STRUCTURE_RULES.indexUniqueEncryptedColumn, {
              message:
                `${where}: column "${col}" is encrypted — a unique index on it can never detect ` +
                `duplicates (non-deterministic ciphertext). Remove \`unique\` or \`encrypted\`.`,
            });
          }
        }
      }
    }
  }
}

// --- Encrypted field validation ---

export function validateEncryptedFields(feature: FeatureDefinition): boolean {
  let found = false;
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      // Both string-typed fields can be encrypted. The
      // searchable/sortable conflict checks apply only to `text`
      // (`longText` does not have these flags at the type level).
      if (field.type !== "text" && field.type !== "longText") continue;
      if (!field.encrypted) continue;
      found = true;

      if (field.type === "text") {
        if (field.searchable) {
          throw bootRuleError(ENTITY_STRUCTURE_RULES.encryptedSearchable, {
            message: `Field "${fieldName}" on entity "${entityName}" cannot be both encrypted and searchable. Drop searchable: true or remove the encryption.`,
          });
        }
        if (field.sortable) {
          throw bootRuleError(ENTITY_STRUCTURE_RULES.encryptedSortable, {
            message: `Field "${fieldName}" on entity "${entityName}" cannot be both encrypted and sortable. Drop sortable: true or remove the encryption.`,
          });
        }
        // AES-GCM draws a fresh random IV per call, so the ciphertext is
        // non-deterministic — an equality filter on it never matches, even
        // against the identical plaintext.
        if (field.filterable) {
          throw bootRuleError(ENTITY_STRUCTURE_RULES.encryptedFilterable, {
            message:
              `Field "${fieldName}" on entity "${entityName}" cannot be both encrypted and filterable ` +
              `— non-deterministic ciphertext never matches an equality filter. Drop filterable: true or remove the encryption.`,
          });
        }
      }
    }
  }
  return found;
}

// --- File field detection ---

export function validateFileFields(feature: FeatureDefinition): boolean {
  for (const entity of Object.values(feature.entities ?? {})) {
    for (const field of Object.values(entity.fields)) {
      if (holdsFileRefs(field)) return true;
    }
  }
  return false;
}

// --- Embedded field validation ---

const VALID_EMBEDDED_SUB_TYPES = new Set([
  "text",
  "number",
  "boolean",
  "date",
  "money",
  "decimal",
  "select",
  "reference",
  "timestamp",
  "images",
  "files",
]);

const NUMERIC_EMBEDDED_SUB_TYPES = new Set(["number", "money", "decimal"]);

// 15 is where 10^scale exhausts a double's integer range — beyond it the
// scale check in the write schema could no longer hold.
function isValidEmbeddedDecimalScale(scale: number): boolean {
  return Number.isInteger(scale) && scale >= 0 && scale <= 15;
}

// ReferenceFieldDef validation, shared by
// top-level reference fields and reference sub-fields of an embedded field
// (only the field-path in error messages differs, e.g. "accountId" vs
// "lines.accountId", so a failure is locatable either way).
//   1) referenced entity exists (same-feature OR cross-feature qualified via
//      "<feature>:<entity>"). Same-feature is the default; cross-feature
//      requires an explicit ":" prefix.
//   2) labelField (if set) exists on the referenced entity.
//   3) Query handler `<feature>:query:<entity>:list` is registered — the
//      renderer fires it on Combobox open, so a missing handler crashes the
//      Combobox at runtime.
//   4) optionsQuery (if set) names a registered query handler.
function validateReferenceTarget(
  entityName: string,
  fieldPath: string,
  refString: string,
  labelField: string | undefined,
  optionsQuery: string | undefined,
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
): void {
  const target = parseRefTarget(refString, feature.name);
  const targetFeature = featureMap.get(target.featureName);
  if (!targetFeature) {
    const knownFeatures = [...featureMap.keys()].sort().join(", ");
    throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.referenceUnknownFeature, {
      message:
        `[Feature ${feature.name}] Reference field "${fieldPath}" on entity "${entityName}" ` +
        `targets unknown feature "${target.featureName}" via "${refString}". ` +
        `Known features: ${knownFeatures}.`,
    });
  }
  const targetEntity = targetFeature.entities?.[target.entityName];
  if (!targetEntity) {
    const known =
      Object.keys(targetFeature.entities ?? {})
        .sort()
        .join(", ") || "(none)";
    const where =
      target.featureName === feature.name
        ? `in this feature`
        : `in feature "${target.featureName}"`;
    throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.referenceUnknownEntity, {
      message:
        `[Feature ${feature.name}] Reference field "${fieldPath}" on entity "${entityName}" ` +
        `targets unknown entity "${target.entityName}" ${where}. ` +
        `Known entities: ${known}.`,
    });
  }
  if (labelField !== undefined) {
    const knownFields = Object.keys(targetEntity.fields);
    // "id" always exists, even without an explicit field definition (PK).
    if (labelField !== "id" && !knownFields.includes(labelField)) {
      throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.referenceUnknownLabelField, {
        message:
          `[Feature ${feature.name}] Reference field "${fieldPath}" on entity "${entityName}" ` +
          `references labelField "${labelField}" which does not exist on entity ` +
          `"${target.entityName}". Known fields: ${[...knownFields, "id"].sort().join(", ")}.`,
      });
    }
  }
  // Pins query-handler existence. The renderer fires
  // `<targetFeature>:query:<targetEntity>:list` on Combobox open
  // (use-reference-lookup, ReferenceInput); without a handler that's a 404
  // on first click. defaultEntityQueryHandler names are stored short as
  // "<entity>:list" in feature.queryHandlers.
  const expectedHandlerShortName = `${target.entityName}:list`;
  if (targetFeature.queryHandlers[expectedHandlerShortName] === undefined) {
    throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.referenceTargetWithoutListHandler, {
      message:
        `[Feature ${feature.name}] Reference field "${fieldPath}" on entity "${entityName}" ` +
        `targets entity "${target.entityName}" but no list-query-handler is registered ` +
        `there. Add r.queryHandler(defineEntityListHandler("${target.entityName}", ` +
        `${target.entityName}Entity)) to feature "${target.featureName}", or pick a ` +
        `different label/entity.`,
    });
  }
  // The check above still applies when optionsQuery is set: optionsQuery only
  // replaces the picker's option list, while list cells keep resolving the
  // UUID through `<targetFeature>:query:<targetEntity>:list`
  // (use-reference-lookup).
  validateReferenceOptionsQuery(entityName, fieldPath, optionsQuery, feature, queryHandlers);
}

// The picker may source its options from a query handler instead of
// the referenced entity's table. A typo'd QN would only surface as a 404 on
// first Combobox open, so it is pinned at boot — same treatment as
// `DashboardFilterDefinition.optionsQuery` (boot-validator/query-refs.ts).
function validateReferenceOptionsQuery(
  entityName: string,
  fieldPath: string,
  optionsQuery: string | undefined,
  feature: FeatureDefinition,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
): void {
  // skip: a field without optionsQuery keeps the entity-table option source.
  if (optionsQuery === undefined) return;
  if (optionsQuery.length === 0) {
    throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.referenceOptionsQueryEmpty, {
      message:
        `[Feature ${feature.name}] Reference field "${fieldPath}" on entity "${entityName}" ` +
        `has an empty optionsQuery. Drop the property or name a query handler.`,
    });
  }
  if (!queryHandlers.has(optionsQuery)) {
    throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.referenceOptionsQueryUnregistered, {
      message:
        `[Feature ${feature.name}] Reference field "${fieldPath}" on entity "${entityName}" ` +
        `declares optionsQuery "${optionsQuery}" which is not a registered query-handler. ` +
        `Check the QN spelling (expected "<feature>:query:<short>") and that the handler ` +
        `is declared via r.queryHandler(...).`,
    });
  }
}

// ReferenceFieldDef validation for top-level
// reference fields (self-reference, entity → entity, is allowed). The actual
// checks run in validateReferenceTarget — shared with the reference
// sub-fields of an embedded field (validateEmbeddedFields).
export function validateReferenceFields(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.type !== "reference") continue;
      validateReferenceTarget(
        entityName,
        fieldName,
        field.entity,
        field.labelField,
        field.optionsQuery,
        feature,
        featureMap,
        queryHandlers,
      );
    }
  }
}

export function validateEmbeddedFields(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.type !== "embedded") continue;

      if (!field.schema || Object.keys(field.schema).length === 0) {
        throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedSchemaEmpty, {
          message: `Embedded field "${fieldName}" on entity "${entityName}" in feature "${feature.name}" has an empty schema. Declare at least one sub-field in the embedded schema.`,
        });
      }

      for (const [subName, subField] of Object.entries(field.schema)) {
        if (!VALID_EMBEDDED_SUB_TYPES.has(subField.type)) {
          throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedSubFieldTypeInvalid, {
            message: `Embedded field "${fieldName}.${subName}" on entity "${entityName}" has invalid type "${subField.type}". Allowed: ${[...VALID_EMBEDDED_SUB_TYPES].join(", ")}`,
          });
        }
        if (subField.type === "decimal" && !isValidEmbeddedDecimalScale(subField.scale)) {
          throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedDecimalScaleInvalid, {
            message: `Embedded field "${fieldName}.${subName}" on entity "${entityName}" has invalid scale ${subField.scale}. Must be an integer between 0 and 15.`,
          });
        }
        if (subField.type === "select" && subField.options.length === 0) {
          throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedSelectOptionsEmpty, {
            message: `Embedded field "${fieldName}.${subName}" on entity "${entityName}" has empty options. Add at least one option.`,
          });
        }
        // Reference sub-fields get the same target/labelField/query-handler
        // checks as a top-level reference field — same failure mode
        // (crashing Combobox at runtime) if skipped, so it can't stay a
        // second-class citizen just because it's nested.
        if (subField.type === "reference") {
          validateReferenceTarget(
            entityName,
            `${fieldName}.${subName}`,
            subField.entity,
            subField.labelField,
            subField.optionsQuery,
            feature,
            featureMap,
            queryHandlers,
          );
        }
      }

      validateEmbeddedListMetadata(fieldName, entityName, field, entity);
    }
  }
}

function validateEmbeddedListBounds(
  fieldName: string,
  entityName: string,
  field: EmbeddedFieldDef,
): void {
  if (field.minItems !== undefined && field.minItems < 0) {
    throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedMinItemsNegative, {
      message: `Embedded-list field "${fieldName}" on entity "${entityName}" has invalid minItems ${field.minItems}. Must be >= 0.`,
    });
  }
  if (field.maxItems !== undefined && field.maxItems < 1) {
    throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedMaxItemsTooSmall, {
      message: `Embedded-list field "${fieldName}" on entity "${entityName}" has invalid maxItems ${field.maxItems}. Must be >= 1.`,
    });
  }
  if (
    field.minItems !== undefined &&
    field.maxItems !== undefined &&
    field.minItems > field.maxItems
  ) {
    throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedMinItemsAboveMax, {
      message: `Embedded-list field "${fieldName}" on entity "${entityName}" has minItems ${field.minItems} greater than maxItems ${field.maxItems}. Set minItems at or below maxItems.`,
    });
  }
  // required:true means "at least one row" (schema-builder.ts falls back to
  // minItems:1 for that); an explicit minItems:0 would silently win over
  // that and let a required list submit empty — reject the contradiction
  // instead of picking one side of it for the caller.
  if (field.required === true && field.minItems === 0) {
    throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedRequiredMinItemsZero, {
      message: `Embedded-list field "${fieldName}" on entity "${entityName}" sets required:true and minItems:0 — these contradict each other. Drop minItems (defaults to 1) or set required:false.`,
    });
  }
}

function validateEmbeddedDerivedCells(
  fieldName: string,
  entityName: string,
  field: EmbeddedFieldDef,
): void {
  // skip: no derived cells declared — nothing to validate
  if (field.derived === undefined) return;
  for (const [derivedName, derivedDef] of Object.entries(field.derived)) {
    if (!(derivedName in field.schema)) {
      throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedDerivedCellNotInSchema, {
        message: `Embedded-list field "${fieldName}" on entity "${entityName}" has a derived cell "${derivedName}" that is not a sub-field in its schema. Add the sub-field to the schema or remove the derived cell.`,
      });
    }
    if (derivedDef.op === "percent" && derivedDef.from.length !== 2) {
      throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedPercentNeedsTwoSources, {
        message: `Embedded-list field "${fieldName}" on entity "${entityName}" has a derived cell "${derivedName}" with op "percent", which needs exactly two sources (base, rate).`,
      });
    }
    for (const sourceName of derivedDef.from) {
      if (!(sourceName in field.schema)) {
        throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedDerivedSourceUnknown, {
          message: `Embedded-list field "${fieldName}" on entity "${entityName}" has a derived cell "${derivedName}" reading unknown sub-field "${sourceName}". Read only sub-fields that exist in the schema.`,
        });
      }
      if (sourceName in field.derived) {
        throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedDerivedSourceIsDerived, {
          message: `Embedded-list field "${fieldName}" on entity "${entityName}" has a derived cell "${derivedName}" reading derived sub-field "${sourceName}". Read only stored sub-fields, not other derived cells.`,
        });
      }
    }
  }
}

function validateEmbeddedTotalsColumns(
  fieldName: string,
  entityName: string,
  field: EmbeddedFieldDef,
): void {
  // skip: no totals columns declared — nothing to validate
  if (field.totals === undefined) return;
  for (const total of field.totals) {
    if (typeof total !== "string" && total.from.length === 0) {
      throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedTotalsFromEmpty, {
        message: `Embedded-list field "${fieldName}" on entity "${entityName}" has a totals entry "${total.label}" with an empty "from". List at least one number, money or decimal sub-field.`,
      });
    }
    for (const totalName of typeof total === "string" ? [total] : total.from) {
      const totalSubField = field.schema[totalName];
      if (!totalSubField || !NUMERIC_EMBEDDED_SUB_TYPES.has(totalSubField.type)) {
        throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedTotalsNotNumeric, {
          message: `Embedded-list field "${fieldName}" on entity "${entityName}" lists "${totalName}" in totals, but it is not a number/money/decimal sub-field. List only number, money or decimal sub-fields in totals.`,
        });
      }
    }
  }
}

function validateEmbeddedTotalsMatch(
  fieldName: string,
  entityName: string,
  field: EmbeddedFieldDef,
  entity: EntityDefinition,
): void {
  // skip: no totalsMatch declared — nothing to validate
  if (field.totalsMatch === undefined) return;
  for (const [subFieldName, siblingFieldName] of Object.entries(field.totalsMatch)) {
    const subField = field.schema[subFieldName];
    if (subField?.type !== "money") {
      throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedTotalsMatchKeyNotMoney, {
        message: `Embedded-list field "${fieldName}" on entity "${entityName}" has a totalsMatch entry for "${subFieldName}", which is not a money sub-field in its schema. Use a money sub-field as the totalsMatch key.`,
      });
    }
    const siblingField = entity.fields[siblingFieldName];
    if (siblingField?.type !== "money") {
      throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedTotalsMatchSiblingNotMoney, {
        message: `Embedded-list field "${fieldName}" on entity "${entityName}" has a totalsMatch entry mapping "${subFieldName}" to sibling field "${siblingFieldName}", which is not a money field on entity "${entityName}". Map it to a money field of the entity.`,
      });
    }
  }
}

function validateEmbeddedDerivedAndTotals(
  fieldName: string,
  entityName: string,
  field: EmbeddedFieldDef,
  entity: EntityDefinition,
): void {
  validateEmbeddedDerivedCells(fieldName, entityName, field);
  validateEmbeddedTotalsColumns(fieldName, entityName, field);
  validateEmbeddedTotalsMatch(fieldName, entityName, field, entity);
}

function validateEmbeddedListMetadata(
  fieldName: string,
  entityName: string,
  field: EmbeddedFieldDef,
  entity: EntityDefinition,
): void {
  validateEmbeddedListBounds(fieldName, entityName, field);
  if (
    field.multiple !== true &&
    (field.minItems !== undefined ||
      field.maxItems !== undefined ||
      field.derived !== undefined ||
      field.totals !== undefined ||
      field.totalsMatch !== undefined)
  ) {
    throw bootRuleError(ENTITY_REFERENCE_EMBEDDED_RULES.embeddedListOptionsOnNonList, {
      message: `Embedded field "${fieldName}" on entity "${entityName}" sets minItems/maxItems/derived/totals/totalsMatch, which is only valid on an embedded LIST field (multiple: true).`,
    });
  }
  validateEmbeddedDerivedAndTotals(fieldName, entityName, field, entity);
}

// --- lockedWhen validation ---

function isCiphertextAtRest(field: FieldDefinition): boolean {
  return (
    ("pii" in field && field.pii === true) ||
    ("userOwned" in field && field.userOwned !== undefined) ||
    ("tenantOwned" in field && field.tenantOwned === true) ||
    ("recordOwned" in field && field.recordOwned === true) ||
    ("encrypted" in field && field.encrypted === true)
  );
}

// Types whose stored value is a plain scalar that the condition's `===` can match.
// Compound, temporal, array and bigint columns come back in another shape than the
// literal an author writes, so such a lock would silently never hold.
export const LOCKABLE_FIELD_TYPES: ReadonlySet<string> = new Set([
  "text",
  "longText",
  "boolean",
  "select",
  "number",
  "reference",
]);

export function validateLockedWhen(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const { lockedWhen } = entity;
    if (typeof lockedWhen !== "object") continue;
    const where = `Entity "${entityName}" in feature "${feature.name}": lockedWhen field "${lockedWhen.field}"`;
    const field = entity.fields[lockedWhen.field];
    if (!field) {
      throw bootRuleError(ENTITY_STRUCTURE_RULES.lockedWhenUnknownField, {
        message: `${where} is not a field of the entity (known: ${Object.keys(entity.fields).sort().join(", ")}).`,
      });
    }
    if (isCiphertextAtRest(field)) {
      throw bootRuleError(ENTITY_STRUCTURE_RULES.lockedWhenCiphertextField, {
        message: `${where} is personal or encrypted — the lock condition is evaluated on the stored value, which is ciphertext. Use a plaintext field.`,
      });
    }
    if (field.access?.read !== undefined) {
      throw bootRuleError(ENTITY_STRUCTURE_RULES.lockedWhenReadRestricted, {
        message: `${where} has a read restriction — roles that cannot read it get records without it, and the client would show every record as locked. Drop field access.read or use another field.`,
      });
    }
    if (!LOCKABLE_FIELD_TYPES.has(field.type)) {
      throw bootRuleError(FIELD_CONDITION_RULES.conditionFieldTypeNotComparable, {
        message: `${where} has type "${field.type}", which does not store a plain scalar the condition can compare. Use a text, select, boolean, number or reference field.`,
      });
    }
  }
}

// --- Transition validation ---

export function validateTransitions(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    if (!entity.transitions) continue;

    for (const [fieldName, transitionMap] of Object.entries(entity.transitions)) {
      const field = entity.fields[fieldName];

      if (!field) {
        throw bootRuleError(ENTITY_STRUCTURE_RULES.transitionUnknownField, {
          message: `Transitions defined for unknown field "${fieldName}" on entity "${entityName}" in feature "${feature.name}"`,
        });
      }

      if (field.type !== "select") {
        throw bootRuleError(ENTITY_STRUCTURE_RULES.transitionFieldNotSelect, {
          message: `Transitions defined for field "${fieldName}" on entity "${entityName}" but field type is "${field.type}" (must be "select")`,
        });
      }

      const validOptions = new Set(field.options);

      // Check all states in the transition map
      for (const [from, targets] of Object.entries(transitionMap)) {
        if (!validOptions.has(from)) {
          throw bootRuleError(ENTITY_STRUCTURE_RULES.transitionStateNotOption, {
            message: `Transition state "${from}" on "${entityName}.${fieldName}" is not a valid option. Valid: ${[...validOptions].join(", ")}`,
          });
        }
        for (const to of targets) {
          if (!validOptions.has(to)) {
            throw bootRuleError(ENTITY_STRUCTURE_RULES.transitionTargetNotOption, {
              message: `Transition target "${to}" (from "${from}") on "${entityName}.${fieldName}" is not a valid option. Valid: ${[...validOptions].join(", ")}`,
            });
          }
        }
      }
    }
  }
}

// --- extendSchema column collision detection ---

export function validateExtendSchemaCollisions(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const existingFields = new Set(Object.keys(entity.fields));

    // Check if any registered extension would collide with existing fields
    for (const ext of Object.values(feature.registrarExtensions)) {
      if (!ext.extendSchema) continue;
      const extraFields = ext.extendSchema(entityName);
      for (const fieldName of Object.keys(extraFields)) {
        if (existingFields.has(fieldName)) {
          throw bootRuleError(ENTITY_STRUCTURE_RULES.extendSchemaCollision, {
            message: `extendSchema column "${fieldName}" conflicts with existing field on entity "${entityName}". Rename the extension column or the entity field.`,
          });
        }
      }
    }
  }
}

// --- derivedFields / fields collision detection ---
//
// augmentDerivedFields (entity-handlers.ts) does `{...row}` then
// `out[fieldName] = def.derive(row, ctx)` — a derivedFields key that matches a
// stored field name silently overwrites the real, persisted value with the
// derived one on every read, without a boot or runtime error. Reject it here,
// analogous to the extendSchema collision check above.
export function validateDerivedFieldCollisions(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    if (!entity.derivedFields) continue;
    const fieldNames = new Set(Object.keys(entity.fields));
    for (const derivedName of Object.keys(entity.derivedFields)) {
      if (fieldNames.has(derivedName)) {
        throw bootRuleError(ENTITY_STRUCTURE_RULES.derivedFieldCollision, {
          message:
            `Entity "${entityName}": derivedFields key "${derivedName}" conflicts with a stored ` +
            `field of the same name — the derived value would silently overwrite the real one on every read. Rename the derivedFields key or the stored field.`,
        });
      }
    }
  }
}

// --- Searchable fields with restricted read access ---

// The search index is tenant-wide, not per-role: `search` matches every
// searchable field and `filterReadFields` only strips the response afterwards.
// A role that cannot read the field could still guess its value from match
// counts, so the combination is rejected until the index can filter per role.
function isUnrestrictedReadAccess(access: FieldAccess | undefined): boolean {
  const readAccess = access?.read;
  if (readAccess === undefined) return true;
  return Array.isArray(readAccess) ? readAccess.length === 0 : Object.keys(readAccess).length === 0;
}

function throwSearchableRestricted(subject: string, entityName: string): never {
  throw bootRuleError(ENTITY_STRUCTURE_RULES.searchableRestrictedRead, {
    message:
      `${subject} on entity "${entityName}" cannot be searchable with a restricted ` +
      "access.read — the search index is not filtered per role, so search matches would leak " +
      'the value to roles that cannot read it. Drop `searchable`/`find: "fuzzy"` or `access.read`.',
  });
}

export function validateSearchableFieldReadAccess(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.type === "text" && field.searchable && !isUnrestrictedReadAccess(field.access)) {
        throwSearchableRestricted(`Field "${fieldName}"`, entityName);
      }
      if (field.type !== "embedded") continue;
      for (const [subName, subField] of Object.entries(field.schema)) {
        if (subField.searchable !== true) continue;
        if (isUnrestrictedReadAccess(field.access) && isUnrestrictedReadAccess(subField.access)) {
          continue;
        }
        throwSearchableRestricted(`Field "${fieldName}.${subName}"`, entityName);
      }
    }
  }
}
