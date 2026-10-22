import { BILLING_FOUNDATION_FEATURE } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { DELIVERY_FEATURE } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { FEATURE_TOGGLES_FEATURE } from "@cosmicdrift/kumiko-bundled-features/feature-toggles";
import { SUBSCRIPTION_DODO_FEATURE } from "@cosmicdrift/kumiko-bundled-features/subscription-dodo";
import { SUBSCRIPTION_STRIPE_FEATURE } from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
import { TIER_ENGINE_FEATURE } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import type { ExtraRouteDefinition } from "@cosmicdrift/kumiko-framework/api";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { ProdSeedFn } from "../run-prod-app.ts";
import { type BillingBootOption, resolveBillingOption } from "./billing-option.ts";
import { buildDemoModeRoute, type DemoModeOption, withDemoReadOnlyFetch } from "./demo-mode.ts";
import {
  type FeatureTogglesWiring,
  resolveFeatureTogglesOption,
} from "./feature-toggles-option.ts";
import {
  FILE_FOUNDATION_FEATURE,
  type FileStorageBootOption,
  resolveFileStorageOption,
} from "./file-storage-option.ts";
import { type KmsMode, type ResolvedKmsMode, resolveKmsMode } from "./kms-mode.ts";
import { CHANNEL_EMAIL_FEATURE, type MailBootOption, resolveMailOption } from "./mail-option.ts";
import { type DbSeedFn, type ProdSeedsConfig, resolveSeedShortcuts } from "./seed-shortcuts.ts";
import { stackBootWarnings } from "./stack-boot-requirements.ts";

export type BootOptionFields = {
  readonly features: readonly FeatureDefinition[];
  readonly mail?: MailBootOption;
  readonly kmsMode?: KmsMode;
  readonly fileStorage?: FileStorageBootOption;
  readonly billing?: BillingBootOption;
  readonly featureToggles?: boolean;
  readonly demoMode?: DemoModeOption;
  readonly seeds?: readonly ProdSeedFn[] | ProdSeedsConfig;
  readonly kms?: ResolvedKmsMode["kms"];
  readonly blindIndexKey?: string;
  readonly allowPlaintextPii?: string;
  readonly runSingleInstance?: boolean;
  /** With `runSingleInstance: false`: the worker process mounts the same mail / fileStorage
   *  features (its own boot options or by hand), which silences the boot warning. */
  readonly workerMountsFeatures?: boolean;
  readonly appOverrides?: object;
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
  /** Set when `featureToggles` mounted the feature; bind it once the database exists. */
  readonly featureToggles?: FeatureTogglesWiring;
  /** True when `mail` mounted a transport; the auth mail flows then wire without `SMTP_HOST`. */
  readonly mailConfigured: boolean;
  readonly wrapFetch: <TArg>(
    handler: (req: Request, arg?: TArg) => Promise<Response>,
  ) => (req: Request, arg?: TArg) => Promise<Response>;
};

export function isSeedFnList<Fn, Config extends object>(
  seeds: readonly Fn[] | Config,
): seeds is readonly Fn[] {
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

// The old option was a function the app computed; ignoring it silently would drop an operator kill-switch.
export function rejectRemovedEffectiveFeatures(options: object): void {
  if ("effectiveFeatures" in options) {
    throw new Error(
      "[runProdApp] The `effectiveFeatures` option was removed — operator switches no longer take effect through it. Set `featureToggles: true` (it mounts feature-toggles and layers the switches over the tier resolver) and drop the `feature-toggles` feature from `features`.",
    );
  }
}

function wireFeatureToggles(
  options: BootOptionFields,
  mounted: ReadonlySet<string>,
): FeatureTogglesWiring | undefined {
  rejectRemovedEffectiveFeatures(options);
  if (options.featureToggles) {
    rejectDoubleMount(mounted, "featureToggles", FEATURE_TOGGLES_FEATURE);
    return resolveFeatureTogglesOption();
  }
  if (mounted.has(FEATURE_TOGGLES_FEATURE)) {
    throw new Error(
      `[runProdApp] ${FEATURE_TOGGLES_FEATURE} is in \`features\` but \`featureToggles\` is not set — its switches would not reach the dispatcher. Set \`featureToggles: true\` and remove the feature from \`features\`.`,
    );
  }
  return undefined;
}

function warnAboutBootOptions(options: BootOptionFields): void {
  const bootWarnings = stackBootWarnings(options).map(
    (line) => `stacks in \`features\` expect boot options that are not set:\n${line}`,
  );
  if (
    options.runSingleInstance === false &&
    (options.mail || options.fileStorage || options.featureToggles || options.appOverrides) &&
    options.workerMountsFeatures !== true
  ) {
    bootWarnings.push(
      "runSingleInstance:false — delivery and file jobs run in runWorkerApp. Pass the same mail / fileStorage / featureToggles / appOverrides options there, or set workerMountsFeatures: true if it mounts those features itself.",
    );
  }
  if (bootWarnings.length > 0) {
    // biome-ignore lint/suspicious/noConsole: boot-time warn, no logger configured this early
    console.warn(`[runProdApp] ${bootWarnings.join("\n[runProdApp] ")}`);
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
      "billing",
      [BILLING_FOUNDATION_FEATURE, TIER_ENGINE_FEATURE],
      "Mount createBillingFoundationFeature() and createTierEngineFeature(), or composeSaasStack from @cosmicdrift/kumiko-dev-server/compose-stacks.",
    );
    if (options.billing.stripe) {
      rejectDoubleMount(mounted, "billing.stripe", SUBSCRIPTION_STRIPE_FEATURE);
    }
    if (options.billing.dodo) {
      rejectDoubleMount(mounted, "billing.dodo", SUBSCRIPTION_DODO_FEATURE);
    }
    const billing = resolveBillingOption(options.billing, envSource);
    features.push(...billing.features);
    extraRoutes.push(billing.route);
  }

  const featureToggles = wireFeatureToggles(options, mounted);
  if (featureToggles) features.push(featureToggles.feature);

  const { demoMode } = options;
  if (demoMode) {
    extraRoutes.push(buildDemoModeRoute(demoMode, envSource));
  }

  warnAboutBootOptions(options);

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
    ...(featureToggles && { featureToggles }),
    shortcutSeeds,
    customSeeds,
    mailConfigured: options.mail !== undefined,
    wrapFetch: (handler) => (demoMode ? withDemoReadOnlyFetch(handler, demoMode) : handler),
  };
}
