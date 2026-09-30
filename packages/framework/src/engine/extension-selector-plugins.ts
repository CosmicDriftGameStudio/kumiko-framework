import type { Registry } from "./types/feature.js";

// Pinned QN of config's selected-extensions query — framework cannot import
// bundled-features, so a pin test bundled-side keeps it equal to the handler.
export const SELECTED_EXTENSIONS_QUERY = "config:query:config-value:selected-extensions";

export const EXTENSION_SELECTOR_HINT_KEY = "config.settings.extensionSelectorHint";

export function selectablePluginIds(
  registry: Pick<Registry, "getExtensionUsages">,
  extensionName: string,
): string[] {
  return [...new Set(registry.getExtensionUsages(extensionName).map((u) => u.entityName))].sort();
}

export function extensionSelectorTargets(
  registry: Pick<Registry, "getAllExtensionSelectors">,
): ReadonlyMap<string, string> {
  const extensionByKey = new Map<string, string>();
  for (const [extensionName, selectorKey] of registry.getAllExtensionSelectors()) {
    extensionByKey.set(selectorKey, extensionName);
  }
  return extensionByKey;
}
