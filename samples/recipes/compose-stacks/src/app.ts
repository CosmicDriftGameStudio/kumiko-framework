import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  composeAuthStack,
  composeGdprStack,
  composeSaasStack,
  composeSecurityStack,
} from "@cosmicdrift/kumiko-dev-server/compose-stacks";
import type { RunProdAppOptions } from "@cosmicdrift/kumiko-server-runtime";

export const PRO_PRICE_ID = "price_pro_monthly";

export function appFeatures(): RunProdAppOptions["features"] {
  return [
    createConfigFeature(),
    createSecretsFeature(),
    createUserFeature(),
    createTenantFeature(),
    ...composeAuthStack(),
    ...composeSecurityStack(),
    ...composeGdprStack({ tenantLifecycle: true }),
    ...composeSaasStack({
      billing: "stripe",
      tiers: {
        defaultTier: "free",
        tierMap: {
          free: { features: [], caps: { seats: 1 } },
          pro: { features: [], caps: { seats: 25 } },
        },
      },
    }),
  ];
}

type StackBootOptions = Pick<RunProdAppOptions, "kmsMode" | "billing">;

export function bootOptions(): StackBootOptions {
  return {
    kmsMode: "required",
    billing: { stripe: { priceToTier: { [PRO_PRICE_ID]: "pro" } }, defaultTier: "free" },
  };
}
