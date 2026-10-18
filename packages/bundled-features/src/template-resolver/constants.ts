// @runtime client
// Plain data, no imports — the content tree in web/ needs TEXT_BLOCK_KIND to
// pick between the public and the admin query.
//
// RenderKind identifiziert die Konsumenten-Klasse eines Templates.
// Plugin-Renderer in `renderer-foundation` matchen auf kind; der
// Resolver hier ist kind-agnostisch — er lädt nur, das Content-Format
// (markdown/mjml/html) entscheidet wer's rendert.
export const RENDER_KINDS = ["mail", "document-pdf", "image-snapshot"] as const;
export type RenderKind = (typeof RENDER_KINDS)[number];

// Kinds whose html body is a rich document: the server rebuilds it through the
// document schema on every write (see document-sanitizer.ts).
export const DOCUMENT_HTML_KINDS = ["mail", "document-pdf"] as const;
export type DocumentHtmlKind = (typeof DOCUMENT_HTML_KINDS)[number];

// Kinds without a renderer plugin: `notification` is the retired sections-JSON
// notification kind, kept so rows stored before mails moved to `mail` stay
// valid on replay; nothing writes or renders it any more. `text-block` is the Markdown text store
// (ex text-content feature), `snippet` is the content of app collections such
// as reply snippets and signatures (own kind so they stay out of the text-block
// content tree), `ai-prompt` holds LLM prompts, `mail-layout` and
// `pdf-layout` hold the frame a mail/pdf body is rendered into. All are read,
// not rendered on their own — keeping them out of RENDER_KINDS is what stops
// DEFAULT_PLUGIN_BY_KIND from demanding a plugin for them.
export const NON_RENDER_KINDS = [
  "notification",
  "text-block",
  "snippet",
  "ai-prompt",
  "mail-layout",
  "pdf-layout",
] as const;
export type NonRenderKind = (typeof NON_RENDER_KINDS)[number];

// Full kind domain of the entity; RENDER_KINDS is the renderer-foundation subset.
export const TEMPLATE_KINDS = [...RENDER_KINDS, ...NON_RENDER_KINDS] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

// Kinds written through upsertSystem/upsertTenant. `text-block` is absent on
// purpose: it goes through set.write (title + folder tree); two write paths
// onto the same row would drift apart.
export const UPSERT_KINDS = [...RENDER_KINDS, "ai-prompt", "mail-layout", "pdf-layout"] as const;
export type UpsertKind = (typeof UPSERT_KINDS)[number];

// The only kind served by the anonymous-capable by-slug/by-tenant queries and
// by set.write — mail templates and AI prompts are operational internals and
// must not leak through the anonymous path.
export const TEXT_BLOCK_KIND = "text-block" as const;

// Kinds a content collection must not write: a tenant row of these kinds would
// shadow the system notification template or layout without the meta and
// placeholder gates that upsertTenant applies.
export const COLLECTION_REFUSED_KINDS = [
  "mail",
  "mail-layout",
  "pdf-layout",
] as const satisfies readonly TemplateKind[];

export function isCollectionRefusedKind(kind: string): boolean {
  return COLLECTION_REFUSED_KINDS.some((refused) => refused === kind);
}

export const CONTENT_FORMATS = ["markdown", "mjml", "html", "plain"] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const TEMPLATE_SCOPES = ["system", "tenant"] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

export const TEMPLATE_STATUSES = ["draft", "active", "archived"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
export const ACTIVE_TEMPLATE_STATUS = "active" satisfies TemplateStatus;

export {
  PDF_DEFAULT_MARGIN_MM,
  PDF_FOOTER_MARGIN_MM,
  PDF_HEADER_MARGIN_MM,
  PDF_ORIENTATIONS,
  PDF_PAGE_FORMATS,
  type PdfOrientation,
  type PdfPageFormat,
} from "./pdf-constants.js";

// Colors end up inside MJML attributes, so only a strict hex is ever written there.
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_MAIL_LAYOUT_SLUG = "default";
export const DEFAULT_PDF_LAYOUT_SLUG = "default";

// The mail transport enforces no size limit of its own; 10 MiB is a common provider ceiling.
export const MAIL_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

export const TEST_MAIL_SUBJECT_PREFIX = "[TEST] ";

// System-Templates leben unter der canonical SYSTEM_TENANT_ID-Sentinel-UUID.
// Re-Export aus framework — single source of truth, vermeidet Drift.
export { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

// Default-Locale wenn Tenant keinen eigenen Default konfiguriert. Resolver
// fällt darauf zurück wenn requested locale + tenant-default fehlen.
export const FALLBACK_LOCALE = "de";
