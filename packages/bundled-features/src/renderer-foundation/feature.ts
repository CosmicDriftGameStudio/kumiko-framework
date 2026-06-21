import { defineFeature, type Registry } from "@cosmicdrift/kumiko-framework/engine";
import type { RendererPlugin } from "./types";

// renderer-foundation — Plugin-Foundation für Renderer (Notification,
// HTML-Mail, PDF, Image). Plan-Doc:
// kumiko-platform/docs/plans/features/renderer-foundation.md
//
// Pattern symmetrisch zu ai-foundation: Foundation definiert den
// Extension-Point `renderer`, Plugins (renderer-simple, renderer-mail-html,
// renderer-puppeteer-client) registrieren sich via `r.useExtension`.
// Konsumenten holen sich Plugin runtime via createRendererForTenant.
export function createRendererFoundationFeature() {
  return defineFeature("renderer-foundation", (r) => {
    r.describe(
      'Plugin registry for content rendering (notification HTML, mail HTML, PDF, images): call `foundation.createRendererForTenant({ tenantId, kind })` at render time to get the right renderer plugin selected by kind, with tenant-level overrides via the `rendererPluginByKind` config key. Requires `template-resolver` (declared via `r.requires`). Low-level building block \u2014 add `renderer-simple` (or write a custom plugin via `r.useExtension("renderer", name, { kinds, render })`) rather than using this feature alone.',
    );
    r.uiHints({
      displayLabel: "Renderer Foundation",
      category: "notifications",
      recommended: false,
    });
    r.requires("template-resolver");

    r.extendsRegistrar("renderer", {
      onRegister: () => {
        // Plugin-Konformitäts-Check könnte hier: shape-validation der
        // options (kinds, render-Funktion present). Aktuell kein
        // shape-check — Caller's TypeScript-Type-Sicherheit greift.
      },
    });

    return {};
  });
}

// Plugin-Pool-Aufbau zur Boot-Zeit. App-Bootstrap ruft das nach
// Feature-Registration auf, baut den Pool, gibt ihn via extraContext
// an die Handlers weiter.
//
// Symmetrisch zu collectChannels / collectRenderers in delivery-service.
export function collectRendererPlugins(registry: Registry): RendererPlugin[] {
  const usages = registry.getExtensionUsages("renderer");
  return usages.map((usage) => {
    // @cast-boundary engine-payload — extension-usage carries unknown options
    const opts = usage.options as {
      kinds: RendererPlugin["kinds"];
      render: RendererPlugin["render"];
    };
    return {
      name: usage.entityName,
      kinds: opts.kinds,
      render: opts.render,
    };
  });
}
