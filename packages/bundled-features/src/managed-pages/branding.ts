import {
  type ConfigAccessor,
  type ConfigKeyDefinition,
  createTenantConfig,
} from "@cosmicdrift/kumiko-framework/engine";
import { type BrandingTokens, EMPTY_BRANDING } from "../page-render";

// Per-tenant branding, lifted from the publicstatus-local branding-config
// pattern into the framework so every app + studio-tenant gets tenant-editable
// branding. Stored as `config` keys (scope: tenant), edited via the
// configEdit screen (screens/branding-screen.ts), read at render time via the
// branding query.
//
// Write-validated: accent-color must be a CSS hex, logo/site URLs must be
// https. The configEdit screen dispatches `config:write:set` per key, which
// runs the keyDef.pattern gate (set.write.ts → validatePattern). `read: all`
// (scope default) so the anonymous public-render path can read them;
// `write: admin` (TenantAdmin/Admin/SystemAdmin, also the scope default).
//
// CONTINUITY (Phase 5 — Prod trap): these keys land under
// `managed-pages:config:branding-*`, NOT the live `publicstatus:config:
// branding-*`. The publicstatus consumer (Phase 5) MUST migrate the existing
// read_config_values rows to the new QNs per tenant BEFORE switching the read
// path, or every tenant resets to defaults on deploy. The migration is
// deliberately NOT built here — the source QNs belong to the consumer app.

// Anchored, allow-empty (empty = "unset, use default"; cleared via the form).
// Linear → ReDoS-safe on untrusted tenant input. The URL char-class mirrors
// the render-side validator (page-render/branding.ts) so a value that saves
// also renders. text keys carry an explicit length cap too — `validateType`
// only checks the JS type, and the configEdit `maxLength` is client-side, so a
// direct config:write:set would otherwise be unbounded (the page body is
// likewise capped in Phase 2).
const HEX_PATTERN = {
  regex: "^$|^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$",
} as const;
const HTTPS_PATTERN = { regex: "^$|^https://[^\\s\"'<>]{1,2000}$" } as const;
const TITLE_PATTERN = { regex: "^[\\s\\S]{0,200}$" } as const;
const DESCRIPTION_PATTERN = { regex: "^[\\s\\S]{0,500}$" } as const;

export const LAYOUT_PRESETS = ["minimal", "centered", "wide"] as const;

// Short keys → qualified names via define-feature's `qn(feature, "config",
// toKebab(key))`: e.g. `brandingSiteUrl` → `managed-pages:config:branding-
// site-url`. BRANDING_QN below is the single source those QN strings are read
// from (configEdit screen + render read); the integration test pins write-
// target == read-source end-to-end.
export const BRANDING_KEYS = {
  brandingTitle: createTenantConfig("text", { default: "", pattern: TITLE_PATTERN }),
  brandingDescription: createTenantConfig("text", { default: "", pattern: DESCRIPTION_PATTERN }),
  brandingSiteUrl: createTenantConfig("text", { default: "", pattern: HTTPS_PATTERN }),
  brandingAccentColor: createTenantConfig("text", { default: "", pattern: HEX_PATTERN }),
  brandingLogoUrl: createTenantConfig("text", { default: "", pattern: HTTPS_PATTERN }),
  brandingLayoutPreset: createTenantConfig("select", {
    default: "centered",
    options: LAYOUT_PRESETS,
  }),
} satisfies Record<string, ConfigKeyDefinition>;

export const BRANDING_QN = {
  title: "managed-pages:config:branding-title",
  description: "managed-pages:config:branding-description",
  siteUrl: "managed-pages:config:branding-site-url",
  accentColor: "managed-pages:config:branding-accent-color",
  logoUrl: "managed-pages:config:branding-logo-url",
  layoutPreset: "managed-pages:config:branding-layout-preset",
} as const;

export const BRANDING_QUERY_QN = "managed-pages:query:branding";

async function readText(config: ConfigAccessor, qualifiedKey: string): Promise<string> {
  const value = await config(qualifiedKey);
  return typeof value === "string" ? value : "";
}

// Resolve the tenant's branding cascade into render tokens. `config` is
// optional because ctx.config is only wired when the app composes the config
// feature — a missing accessor degrades to defaults (same posture as
// publicstatus' branding read), not a crash.
export async function readBranding(config: ConfigAccessor | undefined): Promise<BrandingTokens> {
  if (!config) return EMPTY_BRANDING;
  const [title, description, siteUrl, accentColor, logoUrl, layoutPreset] = await Promise.all([
    readText(config, BRANDING_QN.title),
    readText(config, BRANDING_QN.description),
    readText(config, BRANDING_QN.siteUrl),
    readText(config, BRANDING_QN.accentColor),
    readText(config, BRANDING_QN.logoUrl),
    readText(config, BRANDING_QN.layoutPreset),
  ]);
  return { title, description, siteUrl, accentColor, logoUrl, layoutPreset };
}

function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

// Coerce the branding query's wire response (`{ data: <BrandingTokens> }`)
// into BrandingTokens at the IO boundary, without an `as` cast — any missing/
// non-string field falls back to "" so a malformed/empty response renders the
// unbranded default rather than throwing.
export function coerceBranding(value: unknown): BrandingTokens {
  if (typeof value !== "object" || value === null) return EMPTY_BRANDING;
  const source = Object.fromEntries(Object.entries(value));
  return {
    title: stringField(source, "title"),
    description: stringField(source, "description"),
    siteUrl: stringField(source, "siteUrl"),
    accentColor: stringField(source, "accentColor"),
    logoUrl: stringField(source, "logoUrl"),
    layoutPreset: stringField(source, "layoutPreset"),
  };
}
