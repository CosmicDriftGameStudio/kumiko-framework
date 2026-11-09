import type { AppContext } from "../engine/types/index.ts";
import { createPayloadDigest, createRateLimitResolver } from "../rate-limit/index.ts";
import type { ServerOptions } from "./server.ts";
import type { BootLogger } from "./server-boot-checks.ts";
import {
  assertNoNonIpRateLimitsWithoutResolver,
  assertNoPayloadRateLimitsWithoutResolver,
  warnUnlimitedSystemScopeFeatures,
} from "./server-boot-checks.ts";

export type ServerRateLimit = {
  readonly resolver: AppContext["rateLimit"];
  readonly middlewareRequested: boolean;
  readonly payloadDigest: ReturnType<typeof createPayloadDigest>;
};

export function resolveServerRateLimit(
  options: Pick<ServerOptions, "registry" | "context" | "rateLimit" | "jwtSecret">,
  tracedRedis: AppContext["redis"],
  bootLog: BootLogger,
): ServerRateLimit {
  // Auto-wire the rate-limit resolver, but ONLY when at least one
  // handler actually declared a rateLimit option. Apps that don't use
  // L3 pay zero cost: no resolver instance, no Lua-script registration
  // on Redis, no AppContext field. Apps that wire L1/L2 middleware can
  // pass `context.rateLimit` explicitly — that takes precedence over
  // the auto-wire (e.g. middleware-only setup without any L3 handler).
  // Auto-build the resolver when L3 handlers declared rateLimit OR when
  // the caller asked for L1/L2 middleware. Either path needs a resolver;
  // both share the same instance to avoid duplicate Lua-script registration.
  const wantsL3 = options.registry.hasRateLimitedHandler();
  const wantsL1L2 =
    options.rateLimit?.global !== undefined || options.rateLimit?.auth !== undefined;
  const wantsHttpRouteLimit = [...options.registry.features.values()].some((feature) =>
    Object.values(feature.httpRoutes).some((route) => route.rateLimit !== undefined),
  );
  const wantsResolver = wantsL3 || wantsL1L2 || wantsHttpRouteLimit;
  // Master for the payload-bucket HMAC: the current signing secret (the
  // keyring's signKid for rotation setups). buildServer always has one, so
  // the digest is available whenever a handler declares additionalRateLimits.
  const payloadDigest = createPayloadDigest(payloadDigestMasterSecret(options.jwtSecret));
  const rateLimitResolver =
    options.context.rateLimit ??
    (tracedRedis && wantsResolver ? createRateLimitResolver({ redis: tracedRedis }) : undefined);
  if (!rateLimitResolver) {
    assertNoPayloadRateLimitsWithoutResolver(options.registry);
    assertNoNonIpRateLimitsWithoutResolver(options.registry);
    warnUnlimitedSystemScopeFeatures(options.registry, bootLog);
  }
  return { resolver: rateLimitResolver, middlewareRequested: wantsL1L2, payloadDigest };
}

function payloadDigestMasterSecret(jwtSecret: ServerOptions["jwtSecret"]): string {
  if (typeof jwtSecret === "string") return jwtSecret;
  const signingSecret = jwtSecret.keys[jwtSecret.signKid];
  if (signingSecret === undefined) {
    throw new Error(
      `[kumiko] jwtSecret.signKid "${jwtSecret.signKid}" not found in jwtSecret.keys`,
    );
  }
  return signingSecret;
}
