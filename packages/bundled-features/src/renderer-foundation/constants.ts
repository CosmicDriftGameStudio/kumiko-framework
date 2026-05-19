// Re-export aus template-resolver — gleiche RenderKind-Domäne. Beide
// Bundles teilen sich die Enum, damit Plugins (renderer-mail-html etc.)
// nicht zwei Quellen importieren müssen.
import type { RenderKind as RenderKindLocal } from "../template-resolver/constants";

export {
  CONTENT_FORMATS,
  RENDER_KINDS,
  type ContentFormat,
  type RenderKind,
} from "../template-resolver/constants";

// Standard-Default-Plugin pro Kind, wenn Tenant keine explizite Config
// gesetzt hat. App-Bootstrap kann das via TenantConfigKey überschreiben.
export const DEFAULT_PLUGIN_BY_KIND: Readonly<Record<RenderKindLocal, string>> = {
  notification: "simple",
  "mail-html": "mail-html",
  "document-pdf": "puppeteer",
  "image-snapshot": "puppeteer",
};
