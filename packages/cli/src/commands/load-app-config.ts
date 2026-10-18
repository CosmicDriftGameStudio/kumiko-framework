import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { CliCommandContext } from "./types";

/** What the CLI reads from kumiko.config.ts. A bare `{ features }` without
 *  defineAppConfig is still accepted for one release. */
export type AppConfig = {
  readonly features: readonly FeatureDefinition[];
  readonly prodFeatures?: readonly FeatureDefinition[];
};

function isAppConfig(value: unknown): value is AppConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "features" in value &&
    Array.isArray(value.features) &&
    (!("prodFeatures" in value) ||
      value.prodFeatures === undefined ||
      Array.isArray(value.prodFeatures))
  );
}

/** Everything prod mounts: lint and docs checks must see the prod-only features too. */
export function allConfiguredFeatures(config: AppConfig): readonly FeatureDefinition[] {
  return [...config.features, ...(config.prodFeatures ?? [])];
}

// kumiko.config.ts is user-authored: a missing default export or `features`
// array must produce a readable message, not a TypeError further down.
export async function loadAppConfig(
  ctx: CliCommandContext,
  configPath: string,
): Promise<AppConfig | null> {
  const mod: unknown = await import(configPath);
  const config =
    typeof mod === "object" && mod !== null && "default" in mod ? mod.default : undefined;
  if (!isAppConfig(config)) {
    ctx.out.err("");
    ctx.out.err(`  ${configPath} must default-export an object with a "features" array:`);
    ctx.out.err('    import { defineAppConfig } from "@cosmicdrift/kumiko-framework/config";');
    ctx.out.err("    export default defineAppConfig({ features: [myFeature], client, ports });");
    ctx.out.err("");
    return null;
  }
  return config;
}
