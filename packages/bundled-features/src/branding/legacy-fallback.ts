import {
  type ConfigKeyDefinition,
  type ConfigValueSource,
  type HandlerContext,
} from "@cosmicdrift/kumiko-framework/engine";
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
// Reads through the resolver because the legacy keys are no longer registered,
// so ctx.config would answer undefined for them.
async function readTextWithLegacyFallback(
  ctx: BrandingReadContext,
  qualifiedKey: string,
  legacyKey: string,
  keyDef: ConfigKeyDefinition,
): Promise<string> {
  const resolver = ctx.services.configResolver;
  if (!resolver) return ctx.config ? textOf(await ctx.config(qualifiedKey)) : "";
  const { tenantId, id: userId } = ctx.user;
  const current = await resolver.getWithSource(qualifiedKey, keyDef, tenantId, userId, ctx.db);
  if (STORED_SOURCES.has(current.source)) return textOf(current.value);
  const legacy = await resolver.getWithSource(legacyKey, keyDef, tenantId, userId, ctx.db);
  if (STORED_SOURCES.has(legacy.source)) return textOf(legacy.value);
  return textOf(current.value);
}

export async function readBrandingWithLegacyFallback(
  ctx: BrandingReadContext,
): Promise<BrandingTokens> {
  if (!ctx.config) return EMPTY_BRANDING;
  const read = (key: keyof typeof BRANDING_KEYS) =>
    readTextWithLegacyFallback(ctx, BRANDING_QN[key], LEGACY_BRANDING_QN[key], BRANDING_KEYS[key]);
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

export function readCustomCssWithLegacyFallback(ctx: BrandingReadContext): Promise<string> {
  return readTextWithLegacyFallback(
    ctx,
    BRANDING_QN.customCss,
    LEGACY_BRANDING_QN.customCss,
    CUSTOM_CSS_KEY.customCss,
  );
}
