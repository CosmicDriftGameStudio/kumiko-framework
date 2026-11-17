import { defineFeature, type Registry } from "@cosmicdrift/kumiko-framework/engine";
import { collectExtensionOptions } from "../shared/index.ts";
import { RENDERER_EXTENSION } from "./constants.ts";
import { isRendererRegistrationPlugin, type RendererPlugin } from "./types.ts";

// Owns the "renderer" extension point; plugins (renderer-mail-html, renderer-puppeteer-client) register through r.applyExtension.
export function createRendererFoundationFeature() {
  return defineFeature("renderer-foundation", (r) => {
    r.describe(
      'Plugin registry for content rendering (mail HTML, PDF, images): call `selectRendererPlugin(collectRendererPlugins(registry), kind)` at render time to get the renderer plugin for a kind, which is the default plugin for that kind when mounted, otherwise the first mounted plugin serving it. Requires `template-resolver` (declared via `r.requires`). Low-level building block \u2014 add `renderer-mail-html` (or write a custom plugin via `r.applyExtension({ name: "renderer", entity: name, kinds, render })`) rather than using this feature alone.',
    );
    r.uiHints({
      displayLabel: "Renderer Foundation",
      category: "notifications",
      recommended: false,
    });
    r.requires({ features: ["template-resolver"] });

    r.extendsRegistrar(RENDERER_EXTENSION, {});

    return {};
  });
}

export function collectRendererPlugins(registry: Registry): RendererPlugin[] {
  return collectExtensionOptions(registry, RENDERER_EXTENSION, isRendererRegistrationPlugin);
}
