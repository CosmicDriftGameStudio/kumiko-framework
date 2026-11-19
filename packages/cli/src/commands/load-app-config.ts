import { join } from "node:path";
import type { AppApiDocsConfig } from "@cosmicdrift/kumiko-framework/config";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { CliCommandContext } from "./types";

const DEFINE_APP_CONFIG_EXAMPLE = [
  '    import { defineAppConfig } from "@cosmicdrift/kumiko-framework/config";',
  '    import { myFeature } from "./src/features/my-feature";',
  '    export default defineAppConfig({ features: [myFeature], client: { entries: ["src/client.tsx"] }, ports: { dev: 4173, e2e: 4174 } });',
] as const;

/** What the CLI reads from kumiko.config.ts. A bare `{ features }` without
 *  defineAppConfig is still accepted for one release. */
export type AppConfig = {
  readonly features: readonly FeatureDefinition[];
  readonly prodFeatures?: readonly FeatureDefinition[];
  readonly includeBundled?: boolean;
  readonly apiDocs?: AppApiDocsConfig;
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
    for (const line of DEFINE_APP_CONFIG_EXAMPLE) ctx.out.err(line);
    ctx.out.err("");
    return null;
  }
  return config;
}

export async function findAppConfigPath(ctx: CliCommandContext): Promise<string | null> {
  const configPath = join(ctx.cwd, "kumiko.config.ts");
  if (await Bun.file(configPath).exists()) return configPath;
  ctx.out.err("");
  ctx.out.err(`  kumiko.config.ts not found at: ${configPath}`);
  ctx.out.err("");
  ctx.out.err("  Create a file that exports your features:");
  ctx.out.err("    // kumiko.config.ts");
  for (const line of DEFINE_APP_CONFIG_EXAMPLE) ctx.out.err(line);
  ctx.out.err("");
  return null;
}

export type AppConfigWithDatabaseUrl = {
  readonly config: AppConfig;
  readonly databaseUrl: string;
};

export async function loadAppConfigWithDatabaseUrl(
  ctx: CliCommandContext,
): Promise<AppConfigWithDatabaseUrl | null> {
  const configPath = await findAppConfigPath(ctx);
  if (configPath === null) return null;
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    ctx.out.err("");
    ctx.out.err("  DATABASE_URL not set. Run against the app env.");
    ctx.out.err("");
    return null;
  }
  const config = await loadAppConfig(ctx, configPath);
  if (config === null) return null;
  return { config, databaseUrl };
}
