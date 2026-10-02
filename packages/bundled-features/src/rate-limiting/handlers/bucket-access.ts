import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import type { RateLimitPer } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import { RateLimitErrors } from "../constants.js";

// Bucket keys are `<dimension>:<subject>[:<handler>]` (framework
// rate-limit/bucket.ts) — only `tenant*` and `user*` carry a subject the
// caller can own. `l1:`/`l2:` (middleware.ts) and every `ip*` bucket are
// global, so they stay SystemAdmin-only.
type BucketCaller = {
  readonly id: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
};

// Typed against RateLimitPer so a renamed dimension in bucket.ts
// breaks the typecheck instead of silently denying access.
const BUCKET_OWNER_KIND: Partial<Record<RateLimitPer, "tenant" | "user">> = {
  tenant: "tenant",
  "tenant+handler": "tenant",
  user: "user",
  "user+handler": "user",
};

function isOwnableDimension(dimension: string): dimension is keyof typeof BUCKET_OWNER_KIND {
  return Object.hasOwn(BUCKET_OWNER_KIND, dimension);
}

function ownsBucket(bucket: string, caller: BucketCaller): boolean {
  const [dimension, subject, ...handler] = bucket.split(":");
  if (dimension === undefined) return false;
  if (!isOwnableDimension(dimension)) return false;
  const owner = BUCKET_OWNER_KIND[dimension] === "tenant" ? caller.tenantId : caller.id;
  // Segment-exact: a startsWith check would pass `tenant:<own-id>-other`.
  if (subject !== owner) return false;
  return dimension.endsWith("+handler") ? handler.length > 0 : handler.length === 0;
}

export function bucketAccessDenied(
  bucket: string,
  caller: BucketCaller,
): AccessDeniedError | undefined {
  if (caller.roles.includes(ROLES.SystemAdmin)) return undefined;
  if (ownsBucket(bucket, caller)) return undefined;
  return new AccessDeniedError({
    i18nKey: "rateLimiting.errors.bucketOutsideTenant",
    details: { reason: RateLimitErrors.bucketOutsideTenant },
  });
}
