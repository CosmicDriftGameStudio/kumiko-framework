import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { CliCommandContext } from "./types";

export type AppConfig = { readonly features: readonly FeatureDefinition[] };

function isAppConfig(value: unknown): value is AppConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "features" in value &&
    Array.isArray(value.features)
  );
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
    ctx.out.err("    export default { features: [myFeature] };");
    ctx.out.err("");
    return null;
  }
  return config;
}
