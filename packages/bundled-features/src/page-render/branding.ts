import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";

// Tenant-branding tokens resolved at render time (managed-pages reads them
// from config — see managed-pages/branding.ts). Empty string = "unset, use
// the base-layout default" (mirrors the publicstatus convention). Every value
// is tenant-supplied + untrusted, so it is re-validated/escaped HERE before it
// touches HTML/CSS output — independent of the write-time config `pattern`
// gate. Defense-in-depth: a value could have been seeded or migrated around
// the write path, so the render path never trusts the stored string.
export type BrandingTokens = {
  readonly title: string;
  readonly description: string;
  readonly siteUrl: string;
  readonly accentColor: string;
  readonly logoUrl: string;
  readonly layoutPreset: string;
};

export const EMPTY_BRANDING: BrandingTokens = {
  title: "",
  description: "",
  siteUrl: "",
  accentColor: "",
  logoUrl: "",
  layoutPreset: "",
};

// CSS hex color: #rgb | #rrggbb | #rrggbbaa, anchored. Contains no `;`/`}`/`<`/
// whitespace, so a value passing this can never break out of `:root{--x:V}`
// or the surrounding <style>…</style>. Linear → ReDoS-safe on untrusted input.
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// https URL, length-bounded, no whitespace/quote/angle chars. Anchored +
// linear (no backtracking).
const HTTPS_URL = /^https:\/\/[^\s"'<>]{1,2000}$/;

export function isSafeHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

export function isSafeHttpsUrl(value: string): boolean {
  return HTTPS_URL.test(value);
}

// Layout preset → body max-width. Unknown/empty → default. Keeps the
// `branding-layout-preset` config key live (read at render, not a declared-
// but-unread key).
const LAYOUT_MAX_WIDTH: Record<string, string> = {
  minimal: "640px",
  centered: "720px",
  wide: "1100px",
};

export function layoutMaxWidth(preset: string): string {
  return LAYOUT_MAX_WIDTH[preset] ?? "720px";
}

// Scoped CSS-variable block, injected after the base <style> so its :root
// declarations override the defaults. Only emits a var whose source value
// passes re-validation — an invalid accent color is dropped (base CSS keeps
// its var() fallback), never injected. The id is stable so an app's custom
// layout can target/override it.
export function brandingStyleBlock(tokens: BrandingTokens): string {
  const decls: string[] = [];
  if (isSafeHexColor(tokens.accentColor)) {
    decls.push(`--accent:${tokens.accentColor}`);
  }
  decls.push(`--page-max-width:${layoutMaxWidth(tokens.layoutPreset)}`);
  return `<style id="tenant-theme">:root{${decls.join(";")}}</style>`;
}

// Optional branded page header (logo + title). The logo is only emitted for a
// re-validated https URL, escaped as an HTML attribute; an invalid/non-https
// URL is dropped. A re-validated https siteUrl turns the header into a
// home-link. Returns "" when there is nothing to show.
export function brandingHeaderHtml(tokens: BrandingTokens): string {
  const parts: string[] = [];
  if (isSafeHttpsUrl(tokens.logoUrl)) {
    const alt = tokens.title ? escapeHtmlAttr(tokens.title) : "logo";
    parts.push(`<img class="brand-logo" src="${escapeHtmlAttr(tokens.logoUrl)}" alt="${alt}">`);
  }
  if (tokens.title) {
    parts.push(`<span class="brand-title">${escapeHtml(tokens.title)}</span>`);
  }
  if (parts.length === 0) return "";

  const inner = parts.join("\n");
  if (isSafeHttpsUrl(tokens.siteUrl)) {
    return `<header class="brand-header"><a href="${escapeHtmlAttr(tokens.siteUrl)}">${inner}</a></header>`;
  }
  return `<header class="brand-header">${inner}</header>`;
}
