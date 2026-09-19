import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import { RateLimitErrors } from "../constants";

// Bucket keys are `<dimension>:<subject>[:<handler>]` (framework
// rate-limit/bucket.ts) — only `tenant*` and `user*` carry a subject the
// caller can own. `l1:`/`l2:` (middleware.ts) and every `ip*` bucket are
// global, so they stay SystemAdmin-only.
type BucketCaller = {
  readonly id: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
};

function ownsBucket(bucket: string, caller: BucketCaller): boolean {
  const [dimension, subject, ...handler] = bucket.split(":");
  if (dimension === undefined) return false;
  const owner =
    dimension === "tenant" || dimension === "tenant+handler"
      ? caller.tenantId
      : dimension === "user" || dimension === "user+handler"
        ? caller.id
        : undefined;
  if (owner === undefined) return false;
  // Segment-exact: a startsWith check would pass `tenant:<own-id>-other`.
  if (subject !== owner) return false;
  return dimension.endsWith("+handler") ? handler.length > 0 : handler.length === 0;
}

export function bucketAccessDenied(
  bucket: string,
  caller: BucketCaller,
): AccessDeniedError | undefined {
  if (caller.roles.includes("SystemAdmin")) return undefined;
  if (ownsBucket(bucket, caller)) return undefined;
  return new AccessDeniedError({
    i18nKey: "rateLimiting.errors.bucketOutsideTenant",
    details: { reason: RateLimitErrors.bucketOutsideTenant },
  });
}
