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
