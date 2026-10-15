// Re-export from template-resolver — same RenderKind domain. Both
// bundles share the enum so plugins (@cosmicdrift/kumiko-renderer-mail-html etc.)
// do not have to import two sources. Cross-feature imports go
// through the barrel (../template-resolver), not via deep import.
import type { RenderKind as RenderKindLocal } from "../template-resolver/index.js";

// Extension-point name for renderer plugins (renderer-simple,
// @cosmicdrift/kumiko-renderer-mail-html, @cosmicdrift/kumiko-renderer-puppeteer-client, ...).
export const RENDERER_EXTENSION = "renderer" as const;

export {
  CONTENT_FORMATS,
  type ContentFormat,
  RENDER_KINDS,
  type RenderKind,
} from "../template-resolver/index.js";

// Standard-Default-Plugin pro Kind, wenn Tenant keine explizite Config
// gesetzt hat. App-Bootstrap kann das via TenantConfigKey überschreiben.
export const DEFAULT_PLUGIN_BY_KIND: Readonly<Record<RenderKindLocal, string>> = {
  notification: "simple",
  "mail-html": "mail-html",
  "document-pdf": "puppeteer",
  "image-snapshot": "puppeteer",
};
