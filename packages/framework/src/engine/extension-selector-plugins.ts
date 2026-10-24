import type { RegistrarExtensionRegistration } from "@cosmicdrift/kumiko-types/config";
import type { Registry } from "./types/feature.ts";

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

// A plugin registered with `selectableInSettings: false` (a test inbox) stays a valid
// stored value for seeds and dev setups, but the generated settings never offer it.
const SELECTABLE_IN_SETTINGS_OPTION = "selectableInSettings";

export function isSelectableInSettings(usage: RegistrarExtensionRegistration): boolean {
  return usage.options?.[SELECTABLE_IN_SETTINGS_OPTION] !== false;
}

export function settingsSelectablePluginIds(
  registry: Pick<Registry, "getExtensionUsages">,
  extensionName: string,
): string[] {
  return [
    ...new Set(
      registry
        .getExtensionUsages(extensionName)
        .filter(isSelectableInSettings)
        .map((u) => u.entityName),
    ),
  ].sort();
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
