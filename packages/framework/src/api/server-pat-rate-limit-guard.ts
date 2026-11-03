import type { MiddlewareHandler } from "hono";
import { getUser } from "./auth-middleware.ts";
import type { LoginRateLimiter } from "./auth-routes.ts";
import { PAT_RATE_LIMITED_CODE } from "./pat-auth-reject.ts";

// Must run after the auth guard so getUser(c) carries the PAT.
export function buildPatRateLimitGuard(patRateLimiter: LoginRateLimiter): MiddlewareHandler {
  return async (c, next) => {
    const pat = getUser(c)?.pat;
    if (pat && !(await patRateLimiter.check(pat.tokenId))) {
      return c.json(
        {
          error: {
            code: PAT_RATE_LIMITED_CODE,
            httpStatus: 429,
            message: "personal access token rate limit exceeded",
            i18nKey: "auth.errors.patRateLimited",
          },
        },
        429,
      );
    }
    return next();
  };
}
