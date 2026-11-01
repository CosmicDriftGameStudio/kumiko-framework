import type { FeatureDefinition, NavDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { PAT_SCREEN_ID } from "../../personal-access-tokens/index.ts";
import {
  localizedLabels,
  localizedLabelsForSuffix,
  localizedScreenTitleLabels,
  pickLabel,
} from "../labels.ts";
import type { RegistryManifestView } from "./../types.ts";
import type { LocalizedText } from "./model.ts";

const MENU_SEPARATOR = " › ";

function perLocale(locales: readonly string[], labels: Readonly<Record<string, string>>) {
  const entries = locales.flatMap((locale) => {
    const label = pickLabel(labels, locale);
    return label === undefined ? [] : [[locale, label] as const];
  });
  return Object.fromEntries(entries);
}

function patListScreenId(registry: RegistryManifestView, feature: FeatureDefinition) {
  const prefix = `${feature.name}:`;
  for (const id of registry.getAllScreens().keys()) {
    if (id.startsWith(prefix) && id.endsWith(`:${PAT_SCREEN_ID}`)) return id;
  }
  return undefined;
}

function navChainTo(
  registry: RegistryManifestView,
  screenId: string,
): readonly NavDefinition[] | undefined {
  const navs = registry.getAllNavs();
  const leaf = [...navs.values()].find((nav) => nav.screen === screenId);
  if (leaf === undefined) return undefined;
  const chain: NavDefinition[] = [];
  const seen = new Set<string>();
  for (let nav: NavDefinition | undefined = leaf; nav && !seen.has(nav.id); ) {
    seen.add(nav.id);
    chain.unshift(nav);
    nav = nav.parent === undefined ? undefined : navs.get(nav.parent);
  }
  return chain;
}

/** The nav chain that leads to the token list ("Settings › API tokens"), or the
 *  screen title when the app places the screen in no nav. */
export function patMenuPath(
  registry: RegistryManifestView,
  feature: FeatureDefinition,
  locales: readonly string[],
): LocalizedText {
  const translations = registry.getAllTranslations();
  const screenId = patListScreenId(registry, feature);
  if (screenId === undefined) return {};
  const chain = navChainTo(registry, screenId);
  if (chain === undefined)
    return perLocale(locales, localizedScreenTitleLabels(translations, screenId));
  return Object.fromEntries(
    locales.map((locale) => [
      locale,
      chain
        .map((nav) => pickLabel(localizedLabels(translations, nav.label), locale) ?? nav.id)
        .join(MENU_SEPARATOR),
    ]),
  );
}

/** Label of the list screen's first navigate toolbar action, the button that opens the mint form. */
export function patCreateLabel(
  registry: RegistryManifestView,
  feature: FeatureDefinition,
  locales: readonly string[],
): LocalizedText {
  const screen = feature.screens?.[PAT_SCREEN_ID];
  if (screen?.type !== "projectionList") return {};
  const action = screen.toolbarActions?.find((candidate) => candidate.kind === "navigate");
  if (action === undefined) return {};
  const labels = localizedLabelsForSuffix(registry.getAllTranslations(), action.label);
  return perLocale(locales, labels);
}
