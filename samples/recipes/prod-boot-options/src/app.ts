import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createFileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import type { RunProdAppOptions } from "@cosmicdrift/kumiko-server-runtime";

export function appFeatures(): RunProdAppOptions["features"] {
  return [
    createConfigFeature(),
    createTenantFeature(),
    createDeliveryFeature(),
    createFileFoundationFeature(),
  ];
}

type BootOptions = Pick<
  RunProdAppOptions,
  "mail" | "kmsMode" | "fileStorage" | "demoMode" | "signals"
>;

export function bootOptions(envSource: Record<string, string | undefined>): BootOptions {
  return {
    mail: { transport: "smtp-env", from: "Recipe <noreply@recipe.example>" },
    kmsMode: "required",
    fileStorage: { provider: "auto" },
    demoMode: {
      readOnly: envSource["DEMO_READ_ONLY"] === "true",
      notice: { text: { en: "This demo is read-only.", de: "Diese Demo ist schreibgeschützt." } },
    },
    signals: { drainTimeoutMs: 20_000 },
  };
}
