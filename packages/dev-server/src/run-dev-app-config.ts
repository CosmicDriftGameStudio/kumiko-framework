import { EXT_SESSION_STORE } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
} from "@cosmicdrift/kumiko-framework/crypto";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import {
  createRegistry,
  type FeatureDefinition,
  FILE_STORAGE_PROVIDER_BOOT_SENTINEL,
  FILE_STORAGE_PROVIDER_ENV,
  type Registry,
  type ValidateBootOptions,
} from "@cosmicdrift/kumiko-framework/engine";
import { parseEnv } from "@cosmicdrift/kumiko-framework/env";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import {
  assertStackBootRequirements,
  type BootOptionWiring,
  isSeedFnList,
  rejectRemovedEffectiveFeatures,
  resolveBootOptionWiring,
  withBootOptionEnvBlocks,
} from "@cosmicdrift/kumiko-server-runtime";
import { resolveBootCrypto } from "@cosmicdrift/kumiko-server-runtime/boot/boot-crypto";
import {
  composeAppFeatures,
  validateComposedFeatures,
  withEnvDefaults,
} from "@cosmicdrift/kumiko-server-runtime/boot/shared-boot-steps";
import { assertPiiBootInvariants } from "@cosmicdrift/kumiko-server-runtime/pii-boot-gate";
import {
  requireEnv,
  resolveAuthMail,
  resolveUnsubscribeWiring,
} from "@cosmicdrift/kumiko-server-runtime/run-prod-app";
import { assertSessionBootInvariants } from "@cosmicdrift/kumiko-server-runtime/session-boot-gate";
import { logInfo } from "./dev-server-runtime.ts";
import {
  captureEphemeralDevPiiKms,
  type DevPiiKmsResolution,
  resolveDevPiiKms,
} from "./resolve-dev-pii-kms.ts";
import type { RunDevAppAuthOptions, RunDevAppOptions, SeedFn } from "./run-dev-app.ts";

export type BootFailureCleanup = { release: (() => Promise<void>) | undefined };

export type DevBootConfig = {
  readonly stackSeeds: readonly SeedFn[];
  readonly wiring: BootOptionWiring;
  readonly envSource: Record<string, string | undefined>;
  readonly effectiveAuth: ReturnType<typeof resolveAuthMail<RunDevAppAuthOptions>> | undefined;
  readonly unsubscribeLinks: ReturnType<typeof resolveUnsubscribeWiring>["unsubscribeLinks"];
  readonly extraRoutes: RunDevAppOptions["extraRoutes"];
  readonly features: readonly FeatureDefinition[];
};

type DevSeedsConfig = Exclude<RunDevAppOptions["seeds"], readonly SeedFn[] | undefined>;

function splitDevSeeds(options: RunDevAppOptions): {
  readonly seedsConfig: DevSeedsConfig | undefined;
  readonly stackSeeds: readonly SeedFn[];
} {
  const seedsConfig =
    options.seeds !== undefined && !isSeedFnList(options.seeds) ? options.seeds : undefined;
  const stackSeeds =
    options.seeds === undefined
      ? []
      : isSeedFnList(options.seeds)
        ? options.seeds
        : (options.seeds.run ?? []);
  return { seedsConfig, stackSeeds };
}

function parseDevEnvSchema(
  options: RunDevAppOptions,
  seedsConfig: DevSeedsConfig | undefined,
  rawEnvSource: Record<string, string | undefined>,
  envSchema: NonNullable<RunDevAppOptions["envSchema"]>,
): void {
  // Free dev seeds take the test stack; the env blocks only read the declarative part.
  const { seeds: _devSeeds, kms: devKms, ...bootFields } = options;
  const composed = withBootOptionEnvBlocks(envSchema, {
    ...bootFields,
    ...(devKms && { kms: devKms }),
    ...(seedsConfig && { seeds: { ...seedsConfig, run: [] } }),
    features: options.features,
  });
  parseEnv(composed.schema, rawEnvSource, { sources: composed.sources });
}

function devBootOptionWiringInput(
  options: RunDevAppOptions,
  seedsConfig: DevSeedsConfig | undefined,
): Parameters<typeof resolveBootOptionWiring>[0] {
  return {
    features: options.features,
    ...(options.mail && { mail: options.mail }),
    ...(options.fileStorage && { fileStorage: options.fileStorage }),
    ...(options.kmsMode !== undefined && { kmsMode: options.kmsMode }),
    ...(options.billing && { billing: options.billing }),
    ...(options.featureToggles && { featureToggles: true }),
    ...(options.demoMode && { demoMode: options.demoMode }),
    ...(seedsConfig && { seeds: { ...seedsConfig, run: [] } }),
    ...(options.kms && { kms: options.kms }),
    ...(options.blindIndexKey !== undefined && { blindIndexKey: options.blindIndexKey }),
    ...(options.auth && { auth: options.auth }),
  };
}

function collectDevExtraRoutes(
  options: RunDevAppOptions,
  unsubscribeRoutes: ReturnType<typeof resolveUnsubscribeWiring>["unsubscribeRoutes"],
  wiring: BootOptionWiring,
): RunDevAppOptions["extraRoutes"] {
  return unsubscribeRoutes.length === 0 && wiring.extraRoutes.length === 0
    ? options.extraRoutes
    : [...(options.extraRoutes ?? []), ...unsubscribeRoutes, ...wiring.extraRoutes];
}

export async function resolveDevBootConfig(
  options: RunDevAppOptions,
  bootFailure: BootFailureCleanup,
): Promise<DevBootConfig> {
  // Automatically mixes standard features in auth mode through composeFeatures.
  // runProdApp and the per-app Drizzle schema generator use the same helper,
  // keeping migrations and runtime feature composition aligned.
  const rawEnvSource = options.envSource ?? process.env;
  const { seedsConfig, stackSeeds } = splitDevSeeds(options);
  if (options.envSchema) {
    parseDevEnvSchema(options, seedsConfig, rawEnvSource, options.envSchema);
  }
  rejectRemovedEffectiveFeatures(options);
  const wiring = await resolveBootOptionWiring(
    devBootOptionWiringInput(options, seedsConfig),
    rawEnvSource,
  );
  bootFailure.release = () => wiring.kms.close();
  const envSource = withEnvDefaults(wiring.envDefaults, rawEnvSource);
  assertStackBootRequirements(
    {
      features: options.features,
      ...(options.featureToggles && { featureToggles: true }),
    },
    ["featureToggles"],
  );
  // Normalizes auth.mail into the explicit flow fields, symmetrically with
  // runProdApp. hmacSecret is read from the JWT_SECRET environment value and
  // fails fast when unavailable. From this point on, use effectiveAuth rather
  // than options.auth.
  const effectiveAuth = options.auth
    ? resolveAuthMail(options.auth, requireEnv("JWT_SECRET", envSource, "runDevApp"), envSource, {
        mailConfigured: wiring.mailConfigured,
      })
    : undefined;
  const { unsubscribeLinks, unsubscribeRoutes } = resolveUnsubscribeWiring({
    unsubscribe: options.unsubscribe,
    publicOrigin: undefined,
    mailBaseUrl: effectiveAuth?.mail?.baseUrl,
    envSource,
    warn: (message) => createFallbackLogger("runDevApp").warn(message),
  });
  const extraRoutes = collectDevExtraRoutes(options, unsubscribeRoutes, wiring);
  const features = composeAppFeatures(options.features, wiring.features, effectiveAuth);
  return { stackSeeds, wiring, envSource, effectiveAuth, unsubscribeLinks, extraRoutes, features };
}

// An explicitly wired file provider (options.files) satisfies the
// FILE_STORAGE_PROVIDER boot gate. Passed via the validateBoot env option
// instead of mutating process.env, so nothing leaks into later runDevApp
// calls in the same process.
function resolveDevValidateBootOptions(
  options: RunDevAppOptions,
  wiring: BootOptionWiring,
): ValidateBootOptions | undefined {
  const baseBootEnv = {
    ...wiring.envDefaults,
    ...(options.validateBootOptions?.env ?? process.env),
  };
  const hasBootEnvDefaults = Object.keys(wiring.envDefaults).length > 0;
  if (options.files !== undefined && baseBootEnv[FILE_STORAGE_PROVIDER_ENV] === undefined) {
    return {
      ...options.validateBootOptions,
      env: { ...baseBootEnv, [FILE_STORAGE_PROVIDER_ENV]: FILE_STORAGE_PROVIDER_BOOT_SENTINEL },
    };
  }
  return hasBootEnvDefaults
    ? { ...options.validateBootOptions, env: baseBootEnv }
    : options.validateBootOptions;
}

// Run boot validation before creating the server. This catches the same
// errors runProdApp catches (unqualified navigation or handler QNs,
// screen-access violations), which would otherwise only show up as a prod pod
// in CrashLoopBackOff. It throws
// synchronously before a socket is opened.
export function validateDevBoot(
  options: RunDevAppOptions,
  config: DevBootConfig,
): ReturnType<typeof resolveBootCrypto> {
  const bootOptions = resolveDevValidateBootOptions(options, config.wiring);
  // Resolve this before validateBoot: an app-supplied masterKey provider must
  // satisfy the encrypted-field gate exactly as it does in runProdApp.
  const bootCrypto = resolveBootCrypto(config.envSource, options.masterKey);
  validateComposedFeatures(config.features, {
    ...(bootCrypto.entityFieldCipher && { entityFieldCipher: bootCrypto.entityFieldCipher }),
    ...bootOptions,
  });
  return bootCrypto;
}

function resolveDevPiiKmsResolution(
  options: RunDevAppOptions,
  wiring: BootOptionWiring,
): DevPiiKmsResolution {
  return options.kmsMode !== undefined
    ? {
        kms: wiring.kms.kms,
        blindIndexKey: wiring.kms.blindIndexKey,
        generatedBlindIndexKey: false,
        mode: wiring.kms.kms ? "app-kms" : "plaintext",
      }
    : resolveDevPiiKms(options);
}

export function configureDevBootCrypto(
  options: RunDevAppOptions,
  config: DevBootConfig,
  bootCrypto: ReturnType<typeof resolveBootCrypto>,
  resetLateBindings: ReadonlyArray<() => void>,
  bootFailure: BootFailureCleanup,
): { readonly releasePiiKms: () => Promise<void> } {
  const { wiring, features } = config;
  // The app-wide cipher for `encrypted: true` entity fields is resolved lazily
  // by executors, symmetrically with runProdApp.
  configureEntityFieldEncryption(bootCrypto.entityFieldCipher);
  // Configure Subject-KMS and blind-index handling, symmetrically with
  // runProdApp. Dev warns instead of failing for plaintext PII, but kms with
  // lookupable fields still requires blindIndexKey because lookups would fail
  // in every mode.
  const piiKms = resolveDevPiiKmsResolution(options, wiring);
  configurePiiSubjectKms(piiKms.kms);
  configureBlindIndexKey(piiKms.blindIndexKey);
  const releaseEphemeralPiiKms = captureEphemeralDevPiiKms(piiKms);
  // The auth features bind database-backed revokers onto their (possibly shared) instances;
  // stop() swaps them for inert ones so a later stack in the same process never reaches this
  // app's closed connection.
  const releasePiiKms = async (): Promise<void> => {
    for (const reset of resetLateBindings) reset();
    releaseEphemeralPiiKms();
    await wiring.kms.close();
  };
  bootFailure.release = releasePiiKms;
  assertPiiBootInvariants(features, {
    kms: piiKms.kms,
    blindIndexKey: piiKms.blindIndexKey,
    mode: "dev",
  });
  if (piiKms.mode === "ephemeral-default") {
    logInfo(
      "[runDevApp] PII encrypted with in-memory KMS (ephemeral DB); pass kms: false to opt out",
    );
  }
  return { releasePiiKms };
}

// Throwaway registry, built once and reused below — mirrors runProdApp's
// `createRegistry(features)` right after validateBoot. Symmetric
// sessionStoreProviderMounted check to runProdApp's (registry.getExtension-
// Usages, not a raw features.some(...) scan) so dev and prod never ask the
// same question two different ways again.
export function resolveDevAuthRegistry(config: DevBootConfig): {
  readonly registry: Registry | undefined;
  readonly sessionStoreProviderMounted: boolean;
} {
  const registry = config.effectiveAuth ? createRegistry(config.features) : undefined;
  const sessionStoreProviderMounted =
    registry !== undefined && registry.getExtensionUsages(EXT_SESSION_STORE).length > 0;
  assertSessionBootInvariants({
    hasAuth: Boolean(config.effectiveAuth),
    sessionStoreProviderMounted,
    mode: "dev",
  });
  return { registry, sessionStoreProviderMounted };
}
