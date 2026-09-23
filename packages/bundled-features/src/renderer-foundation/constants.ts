// Re-export aus template-resolver — gleiche RenderKind-Domäne. Beide
// Bundles teilen sich die Enum, damit Plugins (renderer-mail-html etc.)
// nicht zwei Quellen importieren müssen. Cross-feature-Imports gehen
// über das Barrel (../template-resolver), nicht via deep-import.
import type { RenderKind as RenderKindLocal } from "../template-resolver";

// Extension-point name for renderer plugins (renderer-simple,
// renderer-mail-html, renderer-puppeteer-client, ...).
export const RENDERER_EXTENSION = "renderer" as const;

export {
  CONTENT_FORMATS,
  type ContentFormat,
  RENDER_KINDS,
  type RenderKind,
} from "../template-resolver";

// Standard-Default-Plugin pro Kind, wenn Tenant keine explizite Config
// gesetzt hat. App-Bootstrap kann das via TenantConfigKey überschreiben.
export const DEFAULT_PLUGIN_BY_KIND: Readonly<Record<RenderKindLocal, string>> = {
  notification: "simple",
  "mail-html": "mail-html",
  "document-pdf": "puppeteer",
  "image-snapshot": "puppeteer",
};
