import type { RateLimitOption, SessionUser } from "../engine/types";

// Build the Redis bucket key for a handler-level rate limit. Format:
//   <handler>:<dimension-tag>:<dimension-value>
// Dimension-tag keeps buckets disjoint when the same tenant/user shows up
// in multiple bucket strategies — `user+handler` and `user` for the same
// user are independent buckets.

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
      return { kind: "key", key: `u:${ctx.user.id}` };
    case "tenant":
      return { kind: "key", key: `t:${ctx.user.tenantId}` };
    case "ip":
      if (!ctx.ip) return { kind: "skip", reason: "no_ip" };
      return { kind: "key", key: `i:${ctx.ip}` };
    case "user+handler":
      return { kind: "key", key: `uh:${ctx.user.id}:${ctx.handlerName}` };
    case "tenant+handler":
      return { kind: "key", key: `th:${ctx.user.tenantId}:${ctx.handlerName}` };
    case "ip+handler":
      if (!ctx.ip) return { kind: "skip", reason: "no_ip" };
      return { kind: "key", key: `ih:${ctx.ip}:${ctx.handlerName}` };
  }
}
