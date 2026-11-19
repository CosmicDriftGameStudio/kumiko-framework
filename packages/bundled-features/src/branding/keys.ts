import {
  access,
  type ConfigKeyDefinition,
  createTenantConfig,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  type BrandingTokens,
  EMPTY_BRANDING,
  OPTIONAL_HEX_COLOR_CONFIG_PATTERN,
  OPTIONAL_HTTPS_URL_CONFIG_PATTERN,
} from "../page-render/index.ts";
import { LAYOUT_PRESETS, LEGACY_BRANDING_QN } from "./constants.ts";
import { computedFromLegacyKey } from "./legacy-computed.ts";

// Per-tenant branding so every app + studio-tenant gets tenant-editable
// branding. Stored as `config` keys (scope: tenant), edited via the
// configEdit screen (screens/branding-settings-screen.ts), read at render time
// via the tokens query.
//
// Write-validated: accent-color must be a CSS hex, logo/site URLs must be
// https. The configEdit screen dispatches `config:write:set` per key, which
// runs the keyDef.pattern gate (set.write.ts → validatePattern). `read: all`
// (scope default) so the anonymous public-render path can read them.
//
// `write: access.withSystem(access.admin)` — tenant admins self-service via
// configEdit AND the system actor (ctx.systemWriteAs) may provision/migrate
// these keys. The scope default (`access.admin`, admin-only) has no system
// path, so a migration could not set them. Adding SYSTEM_ROLE
// keeps the keys human-writable (checkWriteAccess collapses to
// system-only only when system is the SOLE writer), so self-service survives.

// Anchored, allow-empty (empty = "unset, use default"; cleared via the form).
// Linear → ReDoS-safe on untrusted tenant input. Hex and URL patterns come from
// page-render so a value that saves also renders. text keys carry an explicit
// length cap too — `validateType` only checks the JS type, and the configEdit
// `maxLength` is client-side, so a direct config:write:set would otherwise be
// unbounded (the page body is likewise capped).
const TITLE_PATTERN = { regex: "^[\\s\\S]{0,200}$" } as const;
const DESCRIPTION_PATTERN = { regex: "^[\\s\\S]{0,500}$" } as const;
// Custom CSS is too complex for a regex allowlist — the write-time pattern only
// caps length (ReDoS-safe, allow-empty); the real allowlist sanitization runs at
// render (page-render/css-sanitize.ts). Keep this cap in sync with MAX_CSS_LENGTH
// there.
const CUSTOM_CSS_PATTERN = { regex: "^[\\s\\S]{0,8000}$" } as const;

// Empty or a FileRef id (UUID); the upload UI that fills it ships separately.
const FILE_REF_ID_PATTERN = {
  regex: "^$|^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
} as const;

// Short keys → qualified names via define-feature's `qn(feature, "config",
// toKebab(key))`: e.g. `siteUrl` → `branding:config:site-url`. BRANDING_QN is
// the single source those QN strings are read from (configEdit screen + render
// read); the integration test pins write-target == read-source end-to-end.
// Admin self-service + system provisioning.
const BRANDING_WRITE = access.withSystem(access.admin);

export const BRANDING_KEYS = {
  title: createTenantConfig("text", {
    default: "",
    computed: computedFromLegacyKey(LEGACY_BRANDING_QN.title, ""),
    pattern: TITLE_PATTERN,
    write: BRANDING_WRITE,
  }),
  description: createTenantConfig("text", {
    default: "",
    computed: computedFromLegacyKey(LEGACY_BRANDING_QN.description, ""),
    pattern: DESCRIPTION_PATTERN,
    write: BRANDING_WRITE,
  }),
  siteUrl: createTenantConfig("text", {
    default: "",
    computed: computedFromLegacyKey(LEGACY_BRANDING_QN.siteUrl, ""),
    pattern: OPTIONAL_HTTPS_URL_CONFIG_PATTERN,
    write: BRANDING_WRITE,
  }),
  accentColor: createTenantConfig("text", {
    default: "",
    computed: computedFromLegacyKey(LEGACY_BRANDING_QN.accentColor, ""),
    pattern: OPTIONAL_HEX_COLOR_CONFIG_PATTERN,
    write: BRANDING_WRITE,
  }),
  logoUrl: createTenantConfig("text", {
    default: "",
    computed: computedFromLegacyKey(LEGACY_BRANDING_QN.logoUrl, ""),
    pattern: OPTIONAL_HTTPS_URL_CONFIG_PATTERN,
    write: BRANDING_WRITE,
  }),
  // Ownership is checked where it is read (renderer-mail-html: FileRef must belong to the rendering tenant).
  logoFile: createTenantConfig("text", {
    default: "",
    computed: computedFromLegacyKey(LEGACY_BRANDING_QN.logoFile, ""),
    pattern: FILE_REF_ID_PATTERN,
    write: BRANDING_WRITE,
  }),
  layoutPreset: createTenantConfig("select", {
    default: "centered",
    computed: computedFromLegacyKey(LEGACY_BRANDING_QN.layoutPreset, "centered"),
    options: LAYOUT_PRESETS,
    write: BRANDING_WRITE,
  }),
} satisfies Record<string, ConfigKeyDefinition>;

// Registered ONLY when the app passes allowCustomCss:true — kept out of
// BRANDING_KEYS so the CSS editor field + key don't exist when the capability is
// off (fail-closed at the app level). The render-time sanitizer is the real
// safety boundary; this is the opt-in switch + a per-tenant toggle gate.
export const CUSTOM_CSS_KEY = {
  customCss: createTenantConfig("text", {
    default: "",
    computed: computedFromLegacyKey(LEGACY_BRANDING_QN.customCss, ""),
    pattern: CUSTOM_CSS_PATTERN,
  }),
} satisfies Record<string, ConfigKeyDefinition>;

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
    logoFile: stringField(source, "logoFile"),
    layoutPreset: stringField(source, "layoutPreset"),
    customCss: stringField(source, "customCss"),
  };
}
