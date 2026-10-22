import { EXT_SESSION_STORE } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { SESSIONS_FEATURE } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { loadJwtSecretOrKeyring, TRUSTED_PROXY_HOPS_ENV } from "@cosmicdrift/kumiko-framework/api";
import {
  createRegistry,
  type FeatureDefinition,
  type Registry,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging";
import { resolveBootCrypto } from "./boot/boot-crypto.ts";
import {
  composeAppFeatures,
  validateComposedFeatures,
  withEnvDefaults,
} from "./boot/shared-boot-steps.ts";
import {
  type BootOptionWiring,
  resolveBootOptionWiring,
} from "./boot-options/resolve-boot-options.ts";
import { assertStackBootRequirements } from "./boot-options/stack-boot-requirements.ts";
import { assertPiiBootInvariants } from "./pii-boot-gate.ts";
import { resolveRateLimit } from "./rate-limit-defaults.ts";
import { readEnv, requireEnv } from "./require-env.ts";
import { resolveAuthPublicOrigin } from "./resolve-auth-public-origin.ts";
import { resolveUnsubscribeWiring } from "./resolve-unsubscribe-wiring.ts";
import type { RunProdAppOptions } from "./run-prod-app.ts";
import { resolveAuthMail } from "./run-prod-app-boot-context.ts";
import { assertSessionBootInvariants } from "./session-boot-gate.ts";
import { resolveTrustedProxyHops } from "./trusted-proxy-hops.ts";

export type BootAbortCleanup = () => void | Promise<void>;
export type RegisterBootAbortCleanup = (cleanup: BootAbortCleanup) => void;

export async function runWithBootAbortCleanups<T>(
  boot: (register: RegisterBootAbortCleanup) => Promise<T>,
): Promise<T> {
  const abortCleanups: BootAbortCleanup[] = [];
  try {
    return await boot((cleanup) => abortCleanups.push(cleanup));
  } catch (error) {
    // Pools and clients opened before the failing step would otherwise keep the process alive.
    for (const cleanup of abortCleanups.reverse()) {
      await Promise.resolve()
        .then(cleanup)
        .catch(() => undefined);
    }
    throw error;
  }
}

export type ProdBootConfig = {
  readonly bootOptionWiring: BootOptionWiring;
  readonly envSource: Record<string, string | undefined>;
  readonly bootKms: BootOptionWiring["kms"];
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly jwtSecret: string;
  readonly jwtSecretOrKeyring: ReturnType<typeof loadJwtSecretOrKeyring>;
  readonly jwtIssuer: string | undefined;
  readonly instanceId: string | undefined;
  readonly trustedProxyHops: number | undefined;
  readonly resolvedRateLimit: ReturnType<typeof resolveRateLimit>;
  readonly port: number;
};

export type ProdComposedFeatures = ReturnType<typeof resolveUnsubscribeWiring> & {
  readonly effectiveAuth:
    | ReturnType<typeof resolveAuthMail<NonNullable<RunProdAppOptions["auth"]>>>
    | undefined;
  readonly authPublicOrigin: string | undefined;
  readonly features: readonly FeatureDefinition[];
  readonly bootCrypto: ReturnType<typeof resolveBootCrypto>;
  readonly sessionsFeature: FeatureDefinition | undefined;
  readonly registry: Registry;
};

let warnedLegacyJwtSecret = false;
function warnLegacyJwtSecretOnce(): void {
  // skip: already warned once this process — avoid log spam on every boot path.
  if (warnedLegacyJwtSecret) return;
  warnedLegacyJwtSecret = true;
  createFallbackLogger("runProdApp").warn(
    "JWT keyring carries a legacy (pre-rotation) verify-only key — " +
      "it never expires on its own. JWT_SECRET remains a required env (hmacSecret " +
      "fallback + boot requireEnv). To stop verifying with the pre-rotation secret: " +
      "set auth.mail.hmacSecret explicitly, then rotate JWT_SECRET to a fresh value " +
      "that is no longer present in any in-flight token (see resolveAuthMail / " +
      "loadJwtSecretOrKeyring).",
  );
}

export async function resolveProdBootConfig(
  options: RunProdAppOptions,
  decryptedEnvSource: Record<string, string | undefined>,
  log: Logger,
  registerAbortCleanup: RegisterBootAbortCleanup,
): Promise<ProdBootConfig> {
  // Stacks whose boot options are missing and the declarative boot options
  // (mail, kmsMode, fileStorage, billing, demoMode, seed shortcuts) fail here, before any connection. Their defaults sit under
  // the env so an explicitly set variable wins.
  assertStackBootRequirements(options);
  const bootOptionWiring = await resolveBootOptionWiring(options, decryptedEnvSource);
  const envSource = withEnvDefaults(bootOptionWiring.envDefaults, decryptedEnvSource);
  const bootKms = bootOptionWiring.kms;
  registerAbortCleanup(() => bootKms.close());

  // Polyfill before anything else — feature code references Temporal.
  const { ensureTemporalPolyfill } = await import("@cosmicdrift/kumiko-framework/time");
  await ensureTemporalPolyfill();

  // Env-vars: fail-fast. Better a 0s boot crash with a clear error
  // than a 30s timeout chasing a Postgres connection that was never
  // configured.
  const databaseUrl = requireEnv("DATABASE_URL", envSource);
  const redisUrl = requireEnv("REDIS_URL", envSource);
  // JWT_SECRET stays mandatory (also the resolveAuthMail hmacSecret
  // fallback below — a separate, non-rotating HMAC token family, not the
  // session JWT). jwtSecretOrKeyring is the OPTIONAL upgrade: set
  // JWT_SECRET_V<n> + JWT_SECRET_CURRENT_VERSION for zero-downtime
  // rotation of the session-JWT signing key — see loadJwtSecretOrKeyring.
  const jwtSecret = requireEnv("JWT_SECRET", envSource);
  const jwtSecretOrKeyring = loadJwtSecretOrKeyring(envSource);
  if (typeof jwtSecretOrKeyring === "object" && Object.hasOwn(jwtSecretOrKeyring.keys, "legacy")) {
    // Once per process — JWT_SECRET stays a required env (requireEnv above +
    // resolveAuthMail hmacSecret fallback). Retiring the *legacy verify key*
    // means setting auth.mail.hmacSecret explicitly and rotating JWT_SECRET
    // to a fresh value that is no longer in any in-flight token; unsetting
    // JWT_SECRET entirely hard-crashes boot.
    warnLegacyJwtSecretOnce();
  }
  const jwtIssuer = readEnv("JWT_ISSUER", envSource);
  const instanceId = readEnv("KUMIKO_INSTANCE_ID", envSource);
  // options.auth.trustedProxyHops wins; falls back
  // to the env var so ops can close the XFF-spoofing hole per-deployment
  // without a code change (mirrors instanceId's env-first pattern above).
  const trustedProxyHops = resolveTrustedProxyHops({
    option: options.trustedProxyHops,
    authOption: options.auth?.trustedProxyHops,
    envValue: readEnv(TRUSTED_PROXY_HOPS_ENV, envSource),
    nodeEnv: process.env["NODE_ENV"],
  });
  if (trustedProxyHops === undefined) {
    // With 0 hops every request appears to come from the proxy pod, so all IP-keyed
    // rate limiters collapse into one shared bucket behind a reverse proxy.
    log.warn(
      `trustedProxyHops / ${TRUSTED_PROXY_HOPS_ENV} is not set; client IP falls back to the socket address. ` +
        "Behind a reverse proxy all clients share one rate-limit bucket, so the default L1/L2 limits throttle the whole site at once.",
    );
  }
  const resolvedRateLimit = resolveRateLimit(options.rateLimit);
  const port = options.port ?? Number.parseInt(envSource["PORT"] ?? "3000", 10);

  log.info(`booting Kumiko stack on port ${port}`);

  return {
    bootOptionWiring,
    envSource,
    bootKms,
    databaseUrl,
    redisUrl,
    jwtSecret,
    jwtSecretOrKeyring,
    jwtIssuer,
    instanceId,
    trustedProxyHops,
    resolvedRateLimit,
    port,
  };
}

export function composeProdFeatures(
  options: RunProdAppOptions,
  config: ProdBootConfig,
  log: Logger,
): ProdComposedFeatures {
  const { bootOptionWiring, envSource, bootKms, jwtSecret } = config;
  // auth.mail is expanded into the explicit flow fields before feeding both
  // the feature side (buildComposeAuthOptions) and the routes fragment below.
  // From here on, always read effectiveAuth instead of options.auth.
  const effectiveAuth = options.auth
    ? resolveAuthMail(options.auth, jwtSecret, envSource, {
        mailConfigured: bootOptionWiring.mailConfigured,
      })
    : undefined;
  const authPublicOrigin = effectiveAuth
    ? resolveAuthPublicOrigin(effectiveAuth, envSource, (message) => {
        log.warn(message);
      })
    : undefined;

  const { unsubscribeLinks, unsubscribeRoutes } = resolveUnsubscribeWiring({
    unsubscribe: options.unsubscribe,
    publicOrigin: effectiveAuth?.publicOrigin,
    mailBaseUrl: effectiveAuth?.mail?.baseUrl,
    envSource,
    warn: (message) => createFallbackLogger("runProdApp").warn(message),
  });

  // Feature registry. Auth mode automatically mixes config/user/tenant/
  // auth-email-password via composeFeatures, using the same feature list as
  // runDevApp and the per-app schema generator. Build it before any connection
  // so boot mode can validate wiring without opening Postgres or Redis sockets.
  const features = composeAppFeatures(options.features, bootOptionWiring.features, effectiveAuth);

  const bootCrypto = resolveBootCrypto(envSource, options.masterKey);
  validateComposedFeatures(features, {
    env: envSource,
    ...(bootCrypto.entityFieldCipher && { entityFieldCipher: bootCrypto.entityFieldCipher }),
    ...options.validateBootOptions,
  });
  assertPiiBootInvariants(features, {
    kms: bootKms.kms,
    blindIndexKey: bootKms.blindIndexKey,
    allowPlaintextPii: bootKms.allowPlaintextPii,
    mode: "prod",
  });
  const sessionsFeature = features.find((f) => f.name === SESSIONS_FEATURE);
  const registry = createRegistry(features);
  assertSessionBootInvariants({
    hasAuth: Boolean(effectiveAuth),
    sessionStoreProviderMounted: registry.getExtensionUsages(EXT_SESSION_STORE).length > 0,
    mode: "prod",
  });

  return {
    effectiveAuth,
    authPublicOrigin,
    unsubscribeLinks,
    unsubscribeRoutes,
    features,
    bootCrypto,
    sessionsFeature,
    registry,
  };
}
