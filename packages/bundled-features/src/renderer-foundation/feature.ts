import { defineFeature, type Registry } from "@cosmicdrift/kumiko-framework/engine";
import { RENDERER_EXTENSION } from "./constants.js";
import { isRendererRegistrationPlugin, type RendererPlugin } from "./types.js";

// renderer-foundation — plugin foundation for renderers (HTML mail, PDF,
// image). Plan doc:
// kumiko-platform/docs/plans/features/renderer-foundation.md
//
// Pattern symmetric to ai-foundation: the foundation defines the
// extension point `renderer`, plugins (@cosmicdrift/kumiko-renderer-mail-html,
// @cosmicdrift/kumiko-renderer-puppeteer-client) register via `r.useExtension`.
// Consumers get a plugin at runtime via createRendererForTenant.
export function createRendererFoundationFeature() {
  return defineFeature("renderer-foundation", (r) => {
    r.describe(
      'Plugin registry for content rendering (mail HTML, PDF, images): call `foundation.createRendererForTenant({ tenantId, kind })` at render time to get the right renderer plugin selected by kind, with tenant-level overrides via the `rendererPluginByKind` config key. Requires `template-resolver` (declared via `r.requires`). Low-level building block \u2014 add `renderer-mail-html` (or write a custom plugin via `r.useExtension("renderer", name, { kinds, render })`) rather than using this feature alone.',
    );
    r.uiHints({
      displayLabel: "Renderer Foundation",
      category: "notifications",
      recommended: false,
    });
    r.requires({ features: ["template-resolver"] });

    r.extendsRegistrar(RENDERER_EXTENSION, {
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
  const usages = registry.getExtensionUsages(RENDERER_EXTENSION);
  return usages.map((usage) => {
    if (!isRendererRegistrationPlugin(usage.options)) {
      throw new Error(
        `${RENDERER_EXTENSION} registration for "${usage.entityName}" has invalid options`,
      );
    }
    return { name: usage.entityName, ...usage.options };
  });
}
