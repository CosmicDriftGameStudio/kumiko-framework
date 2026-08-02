// @runtime client
// Plain data, no imports — the content tree in web/ needs TEXT_BLOCK_KIND to
// pick between the public and the admin query.
//
// RenderKind identifiziert die Konsumenten-Klasse eines Templates.
// Plugin-Renderer in `renderer-foundation` matchen auf kind; der
// Resolver hier ist kind-agnostisch — er lädt nur, das Content-Format
// (markdown/mjml/html) entscheidet wer's rendert.
export const RENDER_KINDS = [
  "notification",
  "mail-html",
  "document-pdf",
  "image-snapshot",
] as const;
export type RenderKind = (typeof RENDER_KINDS)[number];

// Kinds without a renderer plugin: `text-block` is the Markdown text store
// (ex text-content feature), `ai-prompt` holds LLM prompts. Both are read,
// not rendered — keeping them out of RENDER_KINDS is what stops
// DEFAULT_PLUGIN_BY_KIND from demanding a plugin for them.
export const NON_RENDER_KINDS = ["text-block", "ai-prompt"] as const;
export type NonRenderKind = (typeof NON_RENDER_KINDS)[number];

// Full kind domain of the entity; RENDER_KINDS is the renderer-foundation subset.
export const TEMPLATE_KINDS = [...RENDER_KINDS, ...NON_RENDER_KINDS] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

// Kinds written through upsertSystem/upsertTenant. `text-block` is absent on
// purpose: it goes through set.write (title + folder tree); two write paths
// onto the same row would drift apart.
export const UPSERT_KINDS = [...RENDER_KINDS, "ai-prompt"] as const;
export type UpsertKind = (typeof UPSERT_KINDS)[number];

// The only kind served by the anonymous-capable by-slug/by-tenant queries and
// by set.write — mail templates and AI prompts are operational internals and
// must not leak through the anonymous path.
export const TEXT_BLOCK_KIND = "text-block" as const;

export const CONTENT_FORMATS = ["markdown", "mjml", "html", "plain"] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const TEMPLATE_SCOPES = ["system", "tenant"] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

export const TEMPLATE_STATUSES = ["draft", "active", "archived"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

// System-Templates leben unter der canonical SYSTEM_TENANT_ID-Sentinel-UUID.
// Re-Export aus framework — single source of truth, vermeidet Drift.
export { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

// Default-Locale wenn Tenant keinen eigenen Default konfiguriert. Resolver
// fällt darauf zurück wenn requested locale + tenant-default fehlen.
export const FALLBACK_LOCALE = "de";
