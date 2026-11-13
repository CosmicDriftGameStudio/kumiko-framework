import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { createFallbackLogger } from "../logging/utils.ts";
import type { Dispatcher } from "../pipeline/dispatcher.ts";
import { createAuthRouteContext } from "./auth-routes-context.ts";
import type { AuthRoutesConfig } from "./auth-routes-types.ts";
import type { JwtHelper } from "./jwt.ts";

const log = createFallbackLogger("preview-login");

export const PREVIEW_LOGIN_PATH = "/__kumiko/preview-login";
const PREVIEW_LOGIN_LIFETIME_SECONDS = 60;
const PREVIEW_LOGIN_CLOCK_TOLERANCE_SECONDS = 30;

const EXP_FORMAT = /^\d{1,12}$/;
const SIG_FORMAT = /^[0-9a-fA-F]{64}$/;

export function previewLoginSignature(loginKey: string, exp: string): string {
  return createHmac("sha256", loginKey).update(`kumiko-preview-login:${exp}`).digest("hex");
}

/** exp must lie in the future but no further than lifetime + tolerance, so a leaked key cannot mint long-lived links. */
export function isValidPreviewLoginLink(args: {
  readonly loginKey: string;
  readonly exp: string | undefined;
  readonly sig: string | undefined;
  readonly nowSeconds: number;
}): boolean {
  const { loginKey, exp, sig, nowSeconds } = args;
  if (loginKey === "" || exp === undefined || sig === undefined) return false;
  if (!EXP_FORMAT.test(exp) || !SIG_FORMAT.test(sig)) return false;
  const expSeconds = Number(exp);
  if (expSeconds <= nowSeconds) return false;
  if (
    expSeconds >
    nowSeconds + PREVIEW_LOGIN_LIFETIME_SECONDS + PREVIEW_LOGIN_CLOCK_TOLERANCE_SECONDS
  ) {
    return false;
  }
  const expected = Buffer.from(previewLoginSignature(loginKey, exp), "hex");
  const given = Buffer.from(sig, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ponytail: per-process single-use store (sig -> exp seconds); enough for a one-instance preview,
// use a shared KV (Redis SET NX) if previews ever run multi-instance.

function consumeOnce(consumedSigs: Map<string, number>, sig: string, expSeconds: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  for (const [key, exp] of consumedSigs) {
    if (exp + PREVIEW_LOGIN_CLOCK_TOLERANCE_SECONDS < now) consumedSigs.delete(key);
  }
  if (consumedSigs.has(sig)) return false;
  consumedSigs.set(sig, expSeconds);
  return true;
}

/** Separate from createAuthRoutes: the path lies outside /api, so it must not ride the /api guard chain. */
export function createPreviewLoginRoutes(
  dispatcher: Dispatcher,
  jwt: JwtHelper,
  config: AuthRoutesConfig,
): Hono | undefined {
  const previewLogin = config.previewLogin;
  if (previewLogin === undefined || previewLogin.loginKey === "") return undefined;
  const ctx = createAuthRouteContext(dispatcher, jwt, config);
  const consumedSigs = new Map<string, number>();
  const app = new Hono();
  app.get(PREVIEW_LOGIN_PATH, async (c) => {
    c.header("Cache-Control", "no-store");
    const valid = isValidPreviewLoginLink({
      loginKey: previewLogin.loginKey,
      exp: c.req.query("exp"),
      sig: c.req.query("sig"),
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    if (!valid) return c.body(null, 403);
    const sig = (c.req.query("sig") ?? "").toLowerCase();
    if (!consumeOnce(consumedSigs, sig, Number(c.req.query("exp")))) return c.body(null, 403);
    const owner = await previewLogin.resolveOwnerSession(dispatcher);
    if (owner === undefined) {
      consumedSigs.delete(sig);
      log.error("preview login refused: the owner account is missing or not active");
      return c.body(null, 503);
    }
    const claims = await dispatcher.resolveAuthClaims(owner);
    await ctx.mintSessionAndRespond(
      c,
      Object.keys(claims).length > 0 ? { ...owner, claims } : owner,
    );
    return c.redirect("/", 302);
  });
  return app;
}
