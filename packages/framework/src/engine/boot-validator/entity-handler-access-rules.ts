import type { BootRuleTable } from "./boot-rule.ts";

export const HANDLER_ACCESS_RULES = {
  presaveWithoutMappedWrite: {
    id: "extension/presave-without-mapped-write",
    summary:
      "An extension with preSave is used only on entities that have an entity-mapped write handler.",
    fix: 'Use create/update/delete on a matching entity or name the handler "entity:verb".',
  },
  accessMissing: {
    id: "handler/access-missing",
    summary: "Every write, query and stream handler declares an access rule.",
    fix: "Set access: { roles: [...] } or { openToAll: { reason } }.",
  },
  additionalBucketsEmpty: {
    id: "rate-limit/additional-buckets-empty",
    summary: "additionalRateLimits lists at least one bucket.",
    fix: "Declare a bucket or drop additionalRateLimits.",
  },
  additionalPayloadFieldDuplicate: {
    id: "rate-limit/additional-payload-field-duplicate",
    summary: "additionalRateLimits has one entry per payloadField.",
    fix: "Keep one entry per payloadField.",
  },
  additionalWithoutIpBucket: {
    id: "rate-limit/additional-without-ip-bucket",
    summary: "An anonymous handler with additionalRateLimits also has an ip-keyed rateLimit.",
    fix: 'Set rateLimit: { per: "ip", ... } on the handler.',
  },
  payloadFieldUnknown: {
    id: "rate-limit/payload-field-unknown",
    summary: "Every additionalRateLimits payloadField is a field of the handler schema.",
    fix: "Name a field of the handler Zod object schema.",
  },
  payloadLimitInvalid: {
    id: "rate-limit/payload-limit-invalid",
    summary: "An additionalRateLimits limit is a positive integer.",
    fix: "Set limit to a positive integer.",
  },
  payloadWindowInvalid: {
    id: "rate-limit/payload-window-invalid",
    summary: "An additionalRateLimits windowSeconds is a positive integer.",
    fix: "Set windowSeconds to a positive integer.",
  },
  tenantlessAnonymousAccess: {
    id: "handler/tenantless-anonymous-access",
    summary: "A tenantlessAnonymous handler allows exactly the anonymous role.",
    fix: 'Set access to { roles: ["anonymous"] } or remove tenantlessAnonymous.',
  },
  tenantlessAnonymousWithoutRateLimit: {
    id: "handler/tenantless-anonymous-without-rate-limit",
    summary: "A tenantlessAnonymous handler declares an active rateLimit.",
    fix: 'Set rateLimit: { per: "ip", ... }; disabled does not count.',
  },
  tenantlessAnonymousRateLimitPer: {
    id: "handler/tenantless-anonymous-rate-limit-per",
    summary: "A tenantlessAnonymous handler rate-limits per ip or ip+handler.",
    fix: 'Use per "ip" or "ip+handler".',
  },
  costWithoutRateLimit: {
    id: "rate-limit/cost-without-rate-limit",
    summary: "rateLimitCost requires an active rateLimit.",
    fix: "Declare rateLimit or drop rateLimitCost.",
  },
  costOnAnonymousHandler: {
    id: "rate-limit/cost-on-anonymous-handler",
    summary: "rateLimitCost is declared only on authenticated handlers without an ip bucket.",
    fix: 'Use a user/tenant bucket and drop "anonymous", or drop rateLimitCost.',
  },
  disabledWithoutReason: {
    id: "rate-limit/disabled-without-reason",
    summary: "A disabled rateLimit carries a non-empty reason.",
    fix: 'Provide { disabled: true, reason: "..." }.',
  },
  bucketListEmpty: {
    id: "rate-limit/bucket-list-empty",
    summary: "A rateLimit array lists at least one bucket.",
    fix: "Declare a bucket or drop the option.",
  },
  bucketPerDuplicate: {
    id: "rate-limit/bucket-per-duplicate",
    summary: 'A rateLimit array has one entry per "per".',
    fix: 'Keep one entry per "per".',
  },
  accessAllRole: {
    id: "handler/access-all-role",
    summary: 'Handler access does not list the role "all".',
    fix: 'Use roles: ["anonymous"] plus an ip rateLimit, or openToAll: { reason }.',
  },
  anonymousWithoutRateLimit: {
    id: "rate-limit/anonymous-without-rate-limit",
    summary: "A handler that allows anonymous callers declares a rateLimit.",
    fix: 'Set rateLimit: { per: "ip", ... } or { disabled: true, reason }.',
  },
  anonymousUserBucket: {
    id: "rate-limit/anonymous-user-bucket",
    summary: "A handler that allows anonymous callers does not bucket per user.",
    fix: 'Use rateLimit.per "ip" or "ip+handler".',
  },
  perInstanceWithTable: {
    id: "projection/per-instance-with-table",
    summary: "A MultiStreamProjection with a table uses shared delivery.",
    fix: 'Use delivery "shared", or drop the table for side-effect-only consumers.',
  },
} as const satisfies BootRuleTable;
