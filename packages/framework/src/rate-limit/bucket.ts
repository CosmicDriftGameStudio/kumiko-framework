import { createHmac } from "node:crypto";
import type {
  PayloadBucketNormalization,
  RateLimitOption,
  SessionUser,
} from "../engine/types/index.js";
import { derivePurposeSecret } from "../secrets/derive-purpose-secret.js";

// Build the Redis bucket key for a handler-level rate limit. Format:
//   <scope-tag>:<identifying segments…>
// The scope tag keeps buckets disjoint when the same tenant/user shows up
// in multiple bucket strategies — `user+handler` and `user` for the same
// user are independent buckets. The first segment is the only one that
// reaches 429 bodies (toPublicBucketName), so it must never carry caller data.

export type BucketContext = {
  readonly handlerName: string;
  readonly user: SessionUser;
  readonly ip: string | undefined;
};

export type BucketResult =
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "skip"; readonly reason: string };

export function buildBucketKey(option: RateLimitOption, ctx: BucketContext): BucketResult {
  switch (option.per) {
    case "user":
      return { kind: "key", key: `user:${ctx.user.id}` };
    case "tenant":
      return { kind: "key", key: `tenant:${ctx.user.tenantId}` };
    case "ip":
      if (!ctx.ip) return { kind: "skip", reason: "no_ip" };
      return { kind: "key", key: `ip:${ctx.ip}` };
    case "user+handler":
      return { kind: "key", key: `user+handler:${ctx.user.id}:${ctx.handlerName}` };
    case "tenant+handler":
      return { kind: "key", key: `tenant+handler:${ctx.user.tenantId}:${ctx.handlerName}` };
    case "ip+handler":
      if (!ctx.ip) return { kind: "skip", reason: "no_ip" };
      return { kind: "key", key: `ip+handler:${ctx.ip}:${ctx.handlerName}` };
  }
}

// Payload-field buckets: the value (e.g. a recipient address) is normalized
// and HMAC-hashed so Redis never holds it in plaintext.
const PAYLOAD_BUCKET_PURPOSE = "kumiko:rate-limit:payload-bucket";

export function normalizePayloadBucketValue(
  value: string,
  normalize?: PayloadBucketNormalization,
): string {
  const base = value.normalize("NFKC").trim().toLowerCase();
  return normalize === "email" ? stripEmailPlusTag(base) : base;
}

// Only the `+tag` suffix is dropped; provider-specific dot rules are not applied.
function stripEmailPlusTag(address: string): string {
  const at = address.lastIndexOf("@");
  if (at === -1) return address;
  const local = address.slice(0, at);
  const plus = local.indexOf("+");
  return plus <= 0 ? address : `${local.slice(0, plus)}${address.slice(at)}`;
}

export function buildPayloadBucketKey(
  tenantId: string,
  handlerName: string,
  field: string,
  digest: string,
): string {
  return `payload+handler:${tenantId}:${handlerName}:${field}:${digest}`;
}

// Everything after the scope tag identifies the caller (IP, user/tenant id,
// auth target, payload digest). IPv6 addresses and handler names contain ":",
// so no later segment can be kept safely by parsing; the client already knows
// which handler/route it called.
export function toPublicBucketName(bucket: string): string {
  const separator = bucket.indexOf(":");
  return separator === -1 ? bucket : bucket.slice(0, separator);
}

// Rotating the JWT secret only resets these buckets (new digests); they are
// ephemeral (TTL 2x window), so no migration is needed.
export function createPayloadDigest(masterSecret: string): (value: string) => string {
  const key = derivePurposeSecret(masterSecret, PAYLOAD_BUCKET_PURPOSE);
  return (value) => createHmac("sha256", key).update(value).digest("hex");
}
