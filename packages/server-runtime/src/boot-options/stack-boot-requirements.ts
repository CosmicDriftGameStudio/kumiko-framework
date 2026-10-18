import { SUBSCRIPTION_PROVIDER_EXTENSION } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  type BootOptionName,
  EXT_FILE_PROVIDER,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import type { RunProdAppOptions } from "../run-prod-app.ts";
import { CHANNEL_EMAIL_FEATURE } from "./mail-option.ts";

export type StackBootOptionFields = Pick<
  RunProdAppOptions,
  "features" | "kms" | "allowPlaintextPii" | BootOptionName
>;

type OptionCheck = {
  readonly isSatisfied: (
    options: StackBootOptionFields,
    mounted: readonly FeatureDefinition[],
  ) => boolean;
  readonly hint: string;
};

function mountsExtension(features: readonly FeatureDefinition[], extensionName: string): boolean {
  return features.some((feature) =>
    feature.extensionUsages.some((usage) => usage.extensionName === extensionName),
  );
}

// The low-level paths still count until the deprecated wiring is gone: an app
// that mounts channel-email or a provider by hand has what the option builds.
const OPTION_CHECKS: { readonly [K in BootOptionName]: OptionCheck } = {
  mail: {
    isSatisfied: (options, mounted) =>
      options.mail !== undefined || mounted.some((f) => f.name === CHANNEL_EMAIL_FEATURE),
    hint: 'set mail: { transport: "smtp-env" }',
  },
  kmsMode: {
    isSatisfied: (options) =>
      options.kmsMode !== undefined ||
      options.kms !== undefined ||
      options.allowPlaintextPii !== undefined,
    hint: 'set kmsMode: "required" (or { plaintextReason } for a demo)',
  },
  fileStorage: {
    isSatisfied: (options, mounted) =>
      options.fileStorage !== undefined || mountsExtension(mounted, EXT_FILE_PROVIDER),
    hint: 'set fileStorage: { provider: "auto" }',
  },
  billing: {
    isSatisfied: (options, mounted) =>
      options.billing !== undefined || mountsExtension(mounted, SUBSCRIPTION_PROVIDER_EXTENSION),
    hint: "set billing: { stripe: { priceToTier }, defaultTier }",
  },
  demoMode: {
    isSatisfied: (options) => options.demoMode !== undefined,
    hint: "set demoMode: { readOnly }",
  },
  seeds: {
    isSatisfied: (options) => options.seeds !== undefined,
    hint: "set seeds",
  },
  signals: {
    isSatisfied: (options) => options.signals !== false,
    hint: "drop signals: false",
  },
  rateLimit: {
    isSatisfied: (options) => options.rateLimit !== false,
    hint: "drop rateLimit: false",
  },
};

/** Reads `bootRequires` from the raw feature list: dedupe may later drop the
 *  tagged copy of a feature two stacks share. */
export function assertStackBootRequirements(options: StackBootOptionFields): void {
  const gaps = new Set<string>();
  for (const feature of options.features) {
    const requirement = feature.bootRequires;
    if (requirement === undefined) continue;
    for (const option of requirement.options) {
      const check = OPTION_CHECKS[option];
      if (!check.isSatisfied(options, options.features)) {
        gaps.add(`  - ${requirement.stack} needs the boot option \`${option}\`: ${check.hint}`);
      }
    }
  }
  if (gaps.size > 0) {
    throw new Error(
      `[runProdApp] stacks in \`features\` need boot options that are not set:\n${[...gaps].join("\n")}`,
    );
  }
}
