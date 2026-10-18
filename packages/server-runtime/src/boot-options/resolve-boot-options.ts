import { BILLING_FOUNDATION_FEATURE } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { DELIVERY_FEATURE } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { SUBSCRIPTION_STRIPE_FEATURE } from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
import { TIER_ENGINE_FEATURE } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import type { ExtraRouteDefinition } from "@cosmicdrift/kumiko-framework/api";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { ProdSeedFn } from "../run-prod-app.js";
import { type BillingBootOption, resolveBillingOption } from "./billing-option.js";
import { buildDemoModeRoute, type DemoModeOption, withDemoReadOnlyFetch } from "./demo-mode.js";
import {
  FILE_FOUNDATION_FEATURE,
  type FileStorageBootOption,
  resolveFileStorageOption,
} from "./file-storage-option.js";
import { type KmsMode, type ResolvedKmsMode, resolveKmsMode } from "./kms-mode.js";
import { CHANNEL_EMAIL_FEATURE, type MailBootOption, resolveMailOption } from "./mail-option.js";
import { type DbSeedFn, type ProdSeedsConfig, resolveSeedShortcuts } from "./seed-shortcuts.js";

export type BootOptionFields = {
  readonly features: readonly FeatureDefinition[];
  readonly mail?: MailBootOption;
  readonly kmsMode?: KmsMode;
  readonly fileStorage?: FileStorageBootOption;
  readonly billing?: BillingBootOption;
  readonly demoMode?: DemoModeOption;
  readonly seeds?: readonly ProdSeedFn[] | ProdSeedsConfig;
  readonly kms?: ResolvedKmsMode["kms"];
  readonly blindIndexKey?: string;
  readonly allowPlaintextPii?: string;
  readonly runSingleInstance?: boolean;
  readonly auth?: {
    readonly admin?: unknown;
    readonly mail?: { readonly from?: string };
  };
};

export type BootOptionWiring = {
  readonly features: readonly FeatureDefinition[];
  readonly extraRoutes: readonly ExtraRouteDefinition[];
  /** Applied under the env: an explicitly set variable always wins. */
  readonly envDefaults: Readonly<Record<string, string>>;
  readonly kms: ResolvedKmsMode;
  readonly shortcutSeeds: readonly DbSeedFn[];
  readonly customSeeds: readonly ProdSeedFn[];
  /** True when `mail` mounted a transport; the auth mail flows then wire without `SMTP_HOST`. */
  readonly mailConfigured: boolean;
  readonly wrapFetch: <TArg>(
    handler: (req: Request, arg?: TArg) => Promise<Response>,
  ) => (req: Request, arg?: TArg) => Promise<Response>;
};

export function isSeedFnList(
  seeds: readonly ProdSeedFn[] | ProdSeedsConfig,
): seeds is readonly ProdSeedFn[] {
  return Array.isArray(seeds);
}

function requireFeatures(
  mounted: ReadonlySet<string>,
  option: string,
  required: readonly string[],
  hint: string,
): void {
  const missing = required.filter((name) => !mounted.has(name));
  if (missing.length > 0) {
    throw new Error(
      `[runProdApp] ${option} needs the feature(s) ${missing.join(", ")} in \`features\`. ${hint}`,
    );
  }
}

function rejectDoubleMount(mounted: ReadonlySet<string>, option: string, feature: string): void {
  if (mounted.has(feature)) {
    throw new Error(
      `[runProdApp] ${option} mounts ${feature} itself — remove it from \`features\` or drop the option.`,
    );
  }
}

/** Runs after the env is validated and KEK slots are decrypted, before any
 *  connection: every misconfiguration of the new options fails here. */
export async function resolveBootOptionWiring(
  options: BootOptionFields,
  envSource: Record<string, string | undefined>,
): Promise<BootOptionWiring> {
  const isProduction = envSource["NODE_ENV"] === "production";
  const mounted = new Set(options.features.map((feature) => feature.name));
  const features: FeatureDefinition[] = [];
  const extraRoutes: ExtraRouteDefinition[] = [];
  let envDefaults: Readonly<Record<string, string>> = {};

  if (options.mail) {
    requireFeatures(mounted, "mail", [DELIVERY_FEATURE], "channel-email sends through delivery.");
    rejectDoubleMount(mounted, "mail", CHANNEL_EMAIL_FEATURE);
    features.push(
      resolveMailOption(options.mail, {
        envSource,
        isProduction,
        authMailFrom: options.auth?.mail?.from,
      }).feature,
    );
  }

  if (options.fileStorage) {
    requireFeatures(
      mounted,
      "fileStorage",
      [FILE_FOUNDATION_FEATURE],
      "Mount it via composeFileStack.",
    );
    const fileStorage = resolveFileStorageOption(options.fileStorage, {
      envSource,
      isProduction,
      mountedFeatureNames: mounted,
    });
    features.push(...fileStorage.features);
    envDefaults = { ...envDefaults, ...fileStorage.envDefaults };
  }

  if (options.billing) {
    requireFeatures(
      mounted,
      "billing.stripe",
      [BILLING_FOUNDATION_FEATURE, TIER_ENGINE_FEATURE],
      "Mount createBillingFoundationFeature() and createTierEngineFeature(), or composeSaasStack from @cosmicdrift/kumiko-dev-server/compose-stacks.",
    );
    rejectDoubleMount(mounted, "billing.stripe", SUBSCRIPTION_STRIPE_FEATURE);
    const billing = resolveBillingOption(options.billing, envSource);
    features.push(billing.feature);
    extraRoutes.push(billing.route);
  }

  const { demoMode } = options;
  if (demoMode) {
    extraRoutes.push(buildDemoModeRoute(demoMode, envSource));
  }

  if (options.runSingleInstance === false && (options.mail || options.fileStorage)) {
    // biome-ignore lint/suspicious/noConsole: boot-time warn, no logger configured this early
    console.warn(
      "[runProdApp] runSingleInstance:false — delivery and file jobs run in runWorkerApp, which does not read mail / fileStorage. Mount the same channel-email and file provider features there.",
    );
  }

  const seeds = options.seeds ?? [];
  const shortcutSeeds = isSeedFnList(seeds)
    ? []
    : resolveSeedShortcuts(seeds, {
        envSource,
        hasAuth: options.auth !== undefined,
        hasAuthAdmin: options.auth?.admin !== undefined,
      });
  const customSeeds = isSeedFnList(seeds) ? seeds : (seeds.run ?? []);

  // Last: it may open a KMS pool, which nothing above should leak on a throw.
  const kms = await resolveKmsMode(options.kmsMode, options, envSource);

  return {
    features,
    extraRoutes,
    envDefaults,
    kms,
    shortcutSeeds,
    customSeeds,
    mailConfigured: options.mail !== undefined,
    wrapFetch: (handler) => (demoMode ? withDemoReadOnlyFetch(handler, demoMode) : handler),
  };
}
