import { DEFAULT_PLUGIN_BY_KIND, type RenderKind } from "./constants.ts";
import { RendererError, type RendererPlugin } from "./types.ts";

export function selectRendererPlugin(
  plugins: ReadonlyArray<RendererPlugin>,
  kind: RenderKind,
): RendererPlugin {
  const servingKind = plugins.filter((plugin) => plugin.kinds.includes(kind));
  const selected =
    servingKind.find((plugin) => plugin.name === DEFAULT_PLUGIN_BY_KIND[kind]) ?? servingKind[0];
  if (selected) return selected;
  throw new RendererError(
    `[renderer-foundation] no plugin registered for kind="${kind}". Mount at least one plugin (renderer-mail-html, renderer-puppeteer-client) for this kind.`,
    "no_plugin_for_kind",
  );
}
