import type { MiddlewareRejectCode } from "./auth-middleware.ts";

export const PAT_RATE_LIMITED_CODE = "pat_rate_limited";

export const patAuthRejectHttpStatus = {
  missing_token: 401,
  invalid_token: 401,
  ambiguous_auth: 400,
  [PAT_RATE_LIMITED_CODE]: 429,
} as const satisfies Partial<Record<MiddlewareRejectCode | typeof PAT_RATE_LIMITED_CODE, number>>;
