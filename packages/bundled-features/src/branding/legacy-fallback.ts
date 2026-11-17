import type {
  ConfigAccessor,
  ConfigKeyDefinition,
  ConfigValueSource,
  HandlerContext,
} from "@cosmicdrift/kumiko-framework/engine";
import { type ConfigSourceReader, readsWithSource } from "../config/index.ts";
import { type BrandingTokens, EMPTY_BRANDING } from "../page-render/index.ts";
import { BRANDING_QN } from "./constants.ts";
import { BRANDING_KEYS, CUSTOM_CSS_KEY } from "./keys.ts";

// Keys under which managed-pages stored tenant branding before it moved into
// this feature. Stored rows stay under these names after the move, so the read
// path falls back to them when the new key has no row.
export const LEGACY_BRANDING_QN = {
  title: "managed-pages:config:branding-title",
  description: "managed-pages:config:branding-description",
  siteUrl: "managed-pages:config:branding-site-url",
  accentColor: "managed-pages:config:branding-accent-color",
  logoUrl: "managed-pages:config:branding-logo-url",
  logoFile: "managed-pages:config:branding-logo-file",
  layoutPreset: "managed-pages:config:branding-layout-preset",
  customCss: "managed-pages:config:branding-custom-css",
} as const;

export type BrandingReadContext = Pick<HandlerContext, "services" | "user" | "config" | "db">;

export type BrandingTextName = keyof typeof LEGACY_BRANDING_QN;

const KEY_DEFINITIONS: Record<BrandingTextName, ConfigKeyDefinition> = {
  ...BRANDING_KEYS,
  ...CUSTOM_CSS_KEY,
};

const STORED_SOURCES: ReadonlySet<ConfigValueSource> = new Set([
  "user-row",
  "tenant-row",
  "system-row",
]);

function textOf(value: string | number | boolean | undefined): string {
  return typeof value === "string" ? value : "";
}

// A stored row under the new key wins (even when cleared to ""); otherwise a
// stored row under the legacy key; otherwise whatever the new key resolves to.
// Reads through a source reader because the legacy keys are no longer
// registered, so a plain accessor would answer undefined for them. Without a
// source reader (stub accessors) only the new key can be read.
async function readText(
  config: ConfigAccessor | undefined,
  readWithSource: ConfigSourceReader | undefined,
  name: BrandingTextName,
): Promise<string> {
  const qualifiedKey = BRANDING_QN[name];
  if (!readWithSource) return config ? textOf(await config(qualifiedKey)) : "";
  const keyDef = KEY_DEFINITIONS[name];
  const current = await readWithSource(qualifiedKey, keyDef);
  if (STORED_SOURCES.has(current.source)) return textOf(current.value);
  const legacy = await readWithSource(LEGACY_BRANDING_QN[name], keyDef);
  if (STORED_SOURCES.has(legacy.source)) return textOf(legacy.value);
  return textOf(current.value);
}

function sourceReaderOfAccessor(
  config: ConfigAccessor | undefined,
): ConfigSourceReader | undefined {
  return config && readsWithSource(config) ? config.readWithSource : undefined;
}

function sourceReaderOfContext(ctx: BrandingReadContext): ConfigSourceReader | undefined {
  const resolver = ctx.services.configResolver;
  if (!resolver) return sourceReaderOfAccessor(ctx.config);
  const { tenantId, id: userId } = ctx.user;
  return (key, keyDef) => resolver.getWithSource(key, keyDef, tenantId, userId, ctx.db);
}

export function readBrandingText(
  config: ConfigAccessor | undefined,
  name: BrandingTextName,
): Promise<string> {
  return readText(config, sourceReaderOfAccessor(config), name);
}

async function readTokens(
  config: ConfigAccessor | undefined,
  readWithSource: ConfigSourceReader | undefined,
): Promise<BrandingTokens> {
  if (!config) return EMPTY_BRANDING;
  const read = (name: BrandingTextName) => readText(config, readWithSource, name);
  const [title, description, siteUrl, accentColor, logoUrl, logoFile, layoutPreset] =
    await Promise.all([
      read("title"),
      read("description"),
      read("siteUrl"),
      read("accentColor"),
      read("logoUrl"),
      read("logoFile"),
      read("layoutPreset"),
    ]);
  // customCss stays "" here — it is gated (allowCustomCss + per-tenant toggle)
  // and read separately by the branding query via readCustomCss.
  return {
    title,
    description,
    siteUrl,
    accentColor,
    logoUrl,
    logoFile,
    layoutPreset,
    customCss: "",
  };
}

export function readBranding(config: ConfigAccessor | undefined): Promise<BrandingTokens> {
  return readTokens(config, sourceReaderOfAccessor(config));
}

export function readCustomCss(config: ConfigAccessor): Promise<string> {
  return readBrandingText(config, "customCss");
}

export function readBrandingWithLegacyFallback(ctx: BrandingReadContext): Promise<BrandingTokens> {
  return readTokens(ctx.config, sourceReaderOfContext(ctx));
}

export function readCustomCssWithLegacyFallback(ctx: BrandingReadContext): Promise<string> {
  return readText(ctx.config, sourceReaderOfContext(ctx), "customCss");
}
