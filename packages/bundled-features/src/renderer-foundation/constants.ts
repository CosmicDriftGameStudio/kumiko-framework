// Re-export from template-resolver — same RenderKind domain. Both
// bundles share the enum so plugins (@cosmicdrift/kumiko-renderer-mail-html etc.)
// do not have to import two sources. Cross-feature imports go
// through the barrel (../template-resolver), not via deep import.
import type { RenderKind as RenderKindLocal } from "../template-resolver/index.ts";

// Extension-point name for renderer plugins (@cosmicdrift/kumiko-renderer-mail-html, @cosmicdrift/kumiko-renderer-puppeteer-client, ...).
export const RENDERER_EXTENSION = "renderer" as const;

export {
  CONTENT_FORMATS,
  type ContentFormat,
  RENDER_KINDS,
  type RenderKind,
} from "../template-resolver/index.ts";

// Standard default plugin for each kind when the tenant has not set explicit configuration.
// App bootstrap can override this through TenantConfigKey.
export const DEFAULT_PLUGIN_BY_KIND: Readonly<Record<RenderKindLocal, string>> = {
  mail: "mail-html",
  "document-pdf": "puppeteer",
  "image-snapshot": "puppeteer",
};
