import { resolveAnonymousAccessFromRegistry } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createDefaultSseBroker } from "@cosmicdrift/kumiko-framework/api";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
} from "@cosmicdrift/kumiko-framework/crypto";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import { createFallbackLogger, setProcessLogger } from "@cosmicdrift/kumiko-framework/logging";
import {
  createEntityCache,
  createEventDedup,
  createIdempotencyGuard,
} from "@cosmicdrift/kumiko-framework/pipeline";
import type { RunProdAppDeps, RunProdAppOptions } from "./run-prod-app.ts";
import {
  addConfigAccessorFactory,
  buildBootExtraContext,
  loggerFromExtraContext,
} from "./run-prod-app-boot-context.ts";
import type { ProdBootConfig, ProdComposedFeatures } from "./run-prod-app-config.ts";
import type { ProdConnections } from "./run-prod-app-connections.ts";

function buildProdExtraContext(
  options: RunProdAppOptions,
  config: ProdBootConfig,
  composed: ProdComposedFeatures,
  connections: ProdConnections,
  deps: RunProdAppDeps,
) {
  const { envSource, bootKms } = config;
  const { registry, features, effectiveAuth, bootCrypto, unsubscribeLinks } = composed;
  const resolvedExtraContext =
    typeof options.extraContext === "function"
      ? options.extraContext(deps)
      : (options.extraContext ?? {});

  // Install framework defaults first; app values in resolvedExtraContext always
  // win (for example, an app-specific configResolver).
  // The app-wide cipher is resolved lazily, so entities without encrypted
  // fields never access it.
  configureEntityFieldEncryption(bootCrypto.entityFieldCipher);
  // Subject-key KMS for pii-annotated fields (crypto-shredding).
  // No adapter only gets this far when assertPiiBootInvariants above let it
  // through: no PII carriers, or an explicit allowPlaintextPii opt-out. The
  // engine then stays off and those fields are stored in plaintext.
  configurePiiSubjectKms(bootKms.kms);
  // Blind-index key boot gate: with KMS enabled, lookupable fields are stored as
  // ciphertext. Without the key, equality lookups such as login by email cannot
  // work, so fail fast rather than allowing silently broken authentication.
  configureBlindIndexKey(bootKms.blindIndexKey);
  const bootLogger = loggerFromExtraContext(resolvedExtraContext);
  if (bootLogger) setProcessLogger(bootLogger);
  const autoExtraContext = buildBootExtraContext({
    db: connections.db,
    features,
    envSource,
    registry,
    hasAuth: !!effectiveAuth,
    sseBroker: deps.sseBroker,
    redis: connections.redis,
    crypto: bootCrypto,
    ...(bootKms.kms && { kms: bootKms.kms }),
    ...(bootLogger && { log: bootLogger }),
    ...(unsubscribeLinks && { unsubscribeLinks }),
    ...(options.appOverrides && { appOverrides: options.appOverrides }),
  });
  return {
    ...addConfigAccessorFactory({ ...autoExtraContext, ...resolvedExtraContext }, registry),
    ...(options.defaultLocale !== undefined && { defaultLocale: options.defaultLocale }),
  };
}

async function resolveProdAnonymousAccess(options: RunProdAppOptions, deps: RunProdAppDeps) {
  const baseAnonymousAccess =
    typeof options.anonymousAccess === "function"
      ? options.anonymousAccess(deps)
      : options.anonymousAccess;
  // tenantResolver / tenantExists come from auth-foundation providers.
  return resolveAnonymousAccessFromRegistry(baseAnonymousAccess, {
    db: deps.db,
    registry: deps.registry,
    warn: (message) => createFallbackLogger("runProdApp").warn(message),
  });
}

export async function buildProdRequestContext(
  options: RunProdAppOptions,
  config: ProdBootConfig,
  composed: ProdComposedFeatures,
  connections: ProdConnections,
) {
  const { db, redis } = connections;
  const { registry, bootCrypto } = composed;
  // Pipeline pieces — same default config as runDevApp's setupTestStack.
  const idempotency = createIdempotencyGuard(redis, { ttlSeconds: 60 });
  const eventDedup = createEventDedup(redis, { ttlSeconds: 60 });
  const entityCache = createEntityCache(redis, { ttlSeconds: 60 });

  // When no lifecycle is supplied, createApiEntrypoint builds and owns it;
  // the handle exposes it for SIGTERM.
  //
  // extraContext and anonymousAccess accept either an object or a factory that
  // receives {db, redis, registry}; factories are useful when boot-time database
  // access is needed, such as a subdomain-to-tenant resolver.
  //
  // Build the SSE broker here so extraContext factories can close over it, and
  // pass the same broker into createApiEntrypoint (sseBroker option) so
  // server-internal broadcasts and app-specific publishes share one broker. Use
  // createDefaultSseBroker so REDIS_URL selects a Redis-backed broker; an
  // unconditional in-memory broker would silently override buildServer's
  // Redis-backed default (ServerOptions.sseBroker always wins) and prevent
  // cross-replica fanout.
  const { sseBroker, ownedRedisSseBroker } = createDefaultSseBroker(config.envSource);
  const deps: RunProdAppDeps = {
    db,
    redis,
    registry,
    sseBroker,
    env: config.envSource,
    ...(bootCrypto.masterKeyProvider && { masterKeyProvider: bootCrypto.masterKeyProvider }),
    ...(bootCrypto.configCipher && { configEncryption: bootCrypto.configCipher }),
  };
  const extraContext = buildProdExtraContext(options, config, composed, connections, deps);
  const resolvedAnonymousAccess = await resolveProdAnonymousAccess(options, deps);

  return {
    idempotency,
    eventDedup,
    entityCache,
    sseBroker,
    ownedRedisSseBroker,
    extraContext,
    resolvedAnonymousAccess,
  };
}

export type ProdRequestContext = Awaited<ReturnType<typeof buildProdRequestContext>>;
