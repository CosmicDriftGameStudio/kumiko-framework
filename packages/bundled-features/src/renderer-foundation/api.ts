// RendererFoundationApi — Cross-Feature-Schnittstelle. Konsumenten
// (delivery, mail-Sender, Solon NKA-PDF-Generator) holen sich pro
// Render-Call den passenden Plugin via `createRendererForTenant`.
// Pattern symmetrisch zu ai-foundation's `createLLMProviderForTenant`.

import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { DEFAULT_PLUGIN_BY_KIND, type RenderKind } from "./constants.js";
import { RendererError, type RendererPlugin } from "./types.js";

export type RendererFoundationApi = {
  /**
   * Selects + returns a RendererPlugin for (tenantId × kind). Callers
   * then invoke `plugin.render(req, ctx)`.
   *
   * **Selection order:**
   *   1. Tenant-specific config (config bundle: `rendererPluginByKind`)
   *   2. DEFAULT_PLUGIN_BY_KIND from constants
   *   3. First plugin in the pool that serves the kind
   *   4. `RendererError("no_plugin_for_kind")` if nothing matches
   *
   * **Caller pattern:** `tenantId` MUST come from the server (typically
   * `ctx.user.tenantId`). Plugins that need service access (e.g.
   * `@cosmicdrift/kumiko-renderer-mail-html` for layout resolution via `template-resolver`)
   * receive `RendererContext` as the second argument to `render()` —
   * matches the pattern of `DeliveryChannel.send(addr, msg, ctx)`.
   * Plugins without service deps ignore ctx.
   */
  readonly createRendererForTenant: (args: {
    readonly tenantId: TenantId;
    readonly kind: RenderKind;
  }) => RendererPlugin;
};

// Plugin-Pool wird zur Boot-Zeit aus Extension-Usages aufgebaut.
// Aus dem Registry kommen alle registrierten Plugins. Foundation-Feature
// baut den Pool via `collectRendererPlugins(registry)` und steckt das
// Result in extraContext.
export function createRendererFoundationApi(
  plugins: ReadonlyArray<RendererPlugin>,
  tenantConfigLookup: (tenantId: TenantId) => Record<string, string> | null = () => null,
): RendererFoundationApi {
  const byKind = indexByKind(plugins);
  return {
    createRendererForTenant: ({ tenantId, kind }) => {
      const tenantConfig = tenantConfigLookup(tenantId) ?? {};

      // 1. Tenant-Override
      const tenantPluginName = tenantConfig[kind];
      if (tenantPluginName) {
        const plugin = plugins.find((p) => p.name === tenantPluginName && p.kinds.includes(kind));
        if (plugin) return plugin;
        // Tenant-Config zeigt auf nicht-registriertes Plugin — fällt durch zu Default
      }

      // 2. Default-Plugin
      const defaultName = DEFAULT_PLUGIN_BY_KIND[kind];
      if (defaultName) {
        const plugin = plugins.find((p) => p.name === defaultName && p.kinds.includes(kind));
        if (plugin) return plugin;
      }

      // 3. Erstes Plugin im Pool das das kind bedient
      const first = byKind.get(kind)?.[0];
      if (first) return first;

      // 4. Kein Plugin → Error
      throw new RendererError(
        `[renderer-foundation] no plugin registered for kind="${kind}". Mount at least one plugin (renderer-mail-html, renderer-puppeteer-client) for this kind.`,
        "no_plugin_for_kind",
      );
    },
  };
}

function indexByKind(plugins: ReadonlyArray<RendererPlugin>): Map<RenderKind, RendererPlugin[]> {
  const map = new Map<RenderKind, RendererPlugin[]>();
  for (const plugin of plugins) {
    for (const kind of plugin.kinds) {
      const list = map.get(kind) ?? [];
      list.push(plugin);
      map.set(kind, list);
    }
  }
  return map;
}

// Single point of truth für "dieser Handler braucht renderer-foundation".
// Pattern symmetrisch zu requireTemplateResolver + requireTextContent.
export function requireRendererFoundation(
  ctx: { readonly rendererFoundation?: RendererFoundationApi } | object,
  callerName: string,
): RendererFoundationApi {
  // @cast-boundary engine-bridge — rendererFoundation kommt per extraContext
  // aus App-Bootstrap.
  const api = (ctx as { rendererFoundation?: RendererFoundationApi }).rendererFoundation;
  if (!api) {
    throw new InternalError({
      message:
        `[${callerName}] ctx.rendererFoundation missing — App-Bootstrap muss ` +
        `extraContext: { rendererFoundation: createRendererFoundationApi(plugins) } setzen ` +
        `(siehe renderer-foundation/README.md).`,
    });
  }
  return api;
}
