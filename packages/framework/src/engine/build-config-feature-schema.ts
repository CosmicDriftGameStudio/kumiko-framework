// Self-Populating Settings-Hub (config-provisioning Phase 2).
//
// Leitet aus den im Registry deklarierten Config-Keys automatisch die
// Settings-UI ab: pro Audience (scope) einen Parent-Nav, pro (Feature ×
// scope) einen configEdit-Screen + Child-Nav darunter. Kein manuelles
// r.screen/r.nav am App-Author.
//
// Sichtbar wird nur ein Key MIT `mask` (siehe ConfigKeyDefinition): mask ist
// die per-Key-Intent „user-facing Einstellung" und trägt zugleich das Label
// (mask.title, ein i18n-Key). Keys ohne mask sind internes Plumbing
// (ENV-provisioniert/computed) und erscheinen nicht.
//
// Die erzeugten Screens/Navs werden von buildAppSchema in die FeatureSchema
// des config-Features (featureName "config") gemerged — der Renderer
// qualifiziert die kurzen ids/refs mit "config". Daher hier durchweg KURZE
// ids/parent/screen-Refs (buildNavRegistrySliceForApp qualifiziert selbst).

import { isOptionsQueryFieldRef } from "@cosmicdrift/kumiko-types/fields";
import { CONFIG_EDIT_ENTITY, fieldLabelKey } from "../i18n/required-surface-keys.js";
import type { WorkspaceSchema } from "../ui-types/index.js";
import { isEncryptedAtRest } from "./config-helpers.js";
import type { ConfigScope } from "./constants.js";
import {
  EXTENSION_SELECTOR_HINT_KEY,
  SELECTED_EXTENSIONS_QUERY,
  selectablePluginIds,
} from "./extension-selector-plugins.js";
import {
  createBooleanField,
  createNumberField,
  createSelectField,
  createTextField,
} from "./factories.js";
import { isKebabSegment, toKebab } from "./qualified-name.js";
import type { ConfigKeyDefinition, TranslationEntry, TranslationKeys } from "./types/config.js";
import type { Registry, SecretKeyDefinition } from "./types/feature.js";
import type { FieldDefinition, OptionsQueryPayload } from "./types/fields.js";
import type { AccessRule } from "./types/handlers.js";
import { isOpenToAllGranted } from "./types/handlers.js";
import type { ExtensionSelectorPanel } from "./types/index.js";
import type { NavDefinition, NavIconKey } from "./types/nav.js";
import type {
  ConfigEditScreenDefinition,
  DashboardPanelDefinition,
  DashboardScreenDefinition,
  EditFieldsSection,
  ScreenDefinition,
  SecretsEditScreenDefinition,
  SecretsEditSection,
} from "./types/screen.js";

// Namespace, unter dem buildAppSchema die generierten Screens/Navs einhängt
// (find-or-create FeatureSchema). MUSS gleich CONFIG_FEATURE aus dem config
// bundled-feature sein — framework kann das const nicht importieren (Richtung
// bundled-features → framework), darum hier gepinnt + Pin-Test bundled-seitig.
export const SETTINGS_HUB_FEATURE = "config";
// Eigene Workspace nur für workspace-mode-Apps (siehe buildAppSchema): Settings
// erscheinen als eigener Switcher-Eintrag, statt die kuratierten App-Workspaces
// zu verschmutzen. Apps ohne Workspaces zeigen die Navs über den no-filter-Pfad.
export const SETTINGS_HUB_WORKSPACE = "settings";

export type ConfigFeatureSchema = {
  readonly screens: readonly ScreenDefinition[];
  readonly navs: readonly NavDefinition[];
  // Fertige Settings-Workspace mit qualifizierten navMembers. Nur present
  // wenn mind. ein Key opt-in via mask hat; buildAppSchema hängt sie NUR an
  // wenn die App bereits Workspaces nutzt (sonst kippt eine workspace-lose
  // App in den Filter-Modus und verliert alle übrigen Navs).
  readonly workspace?: WorkspaceSchema;
  // Generated i18n keys for the secrets screen (label/hint text pulled from
  // the `r.secret()` declaration itself, not authored via r.translations).
  readonly translations?: TranslationKeys;
};

// Audience-Reihenfolge im Sidebar: Plattform vor Tenant vor Benutzer.
const SCOPE_ORDER: Record<ConfigScope, number> = { system: 10, tenant: 20, user: 30 };
const SCOPE_ICON: Record<ConfigScope, NavIconKey> = {
  system: "shield",
  tenant: "building",
  user: "user",
};
const SCOPES_BROAD_TO_DEEP: readonly ConfigScope[] = ["system", "tenant", "user"];

const audienceDescriptionKey = (scope: ConfigScope): string => `config.settings.audience.${scope}`;
const PROVIDER_PANEL_TITLE_ENTRY: TranslationEntry = {
  en: "Provider",
  de: "Anbieter",
  es: "Proveedor",
};
const PROVIDER_SECTION_TITLE_KEY = "config.settings.provider";
const SAVE_PROVIDER_LABEL_KEY = "config.settings.saveProvider";

const audienceNavShortId = (scope: ConfigScope): string => `audience-${scope}`;

// Generated post-boot, never via r.nav() — the boot validator exempts exactly these QNs (an app references one to place the settings group inline).
export const SETTINGS_HUB_AUDIENCE_NAV_QNS: readonly string[] = SCOPES_BROAD_TO_DEEP.map(
  (scope) => `${SETTINGS_HUB_FEATURE}:nav:${audienceNavShortId(scope)}`,
);

// An einem Scope BREITER als der Home-Scope eines Keys darf nur eine für DIESE
// Ebene privilegierte Rolle den (Cascade-)Default setzen — SystemAdmin auf
// system, TenantAdmin/Admin auf tenant. Am Home-Scope gilt das volle write-Set
// (unverändertes Verhalten). So liefert ein tenant-Home-Key wie SMTP zusätzlich
// einen SystemAdmin-only Plattform-Screen; ein Key, dessen write-Set keine
// dieser Rollen nennt, bekommt keinen breiteren Screen (write-Set = opt-in).
const ELEVATED_ROLES: Record<ConfigScope, readonly string[]> = {
  system: ["SystemAdmin"],
  tenant: ["TenantAdmin", "Admin"],
  user: [],
};

// Der interne Maschinen-Akteur (access.system). Ein Key, den NUR diese Rolle
// schreiben darf, ist provisioned-not-user-facing: er gehört nicht in den
// menschlichen Hub (sonst rendert ein Feld, das der sichtbare Mensch nicht
// speichern kann). `as const` für Literal-Verengung am Vergleich.
const MACHINE_WRITE_ROLE = "system" as const;

type MaskedKey = {
  readonly qn: string;
  // Effective group this key is bucketed under for the Settings-Hub —
  // `def.group` if set, else `ownerFeature`. This is what screen/nav
  // generation groups by.
  readonly feature: string;
  // The feature that actually declared this key (always derived from `qn`).
  // Needed to disambiguate field ids when `feature !== ownerFeature` (a
  // cross-feature `group`) and for collision error messages.
  readonly ownerFeature: string;
  readonly shortKey: string;
  readonly def: ConfigKeyDefinition;
};

type ScopedKey = { readonly key: MaskedKey; readonly roles: readonly string[] };

type ScopeResult = {
  readonly screens: readonly ScreenDefinition[];
  readonly navs: readonly NavDefinition[];
  readonly translations?: TranslationKeys;
};

// Its tenant keys/secrets become panels of the selector owner's dashboard, not own navs.
type GatedPlugin = {
  readonly feature: string;
  readonly extension: string;
  readonly pluginId: string;
  readonly scopedKeys: readonly ScopedKey[];
  readonly secrets: readonly DeclaredSecret[];
};

type SelectorGating = {
  readonly pluginsByOwnerGroup: ReadonlyMap<string, readonly GatedPlugin[]>;
  readonly ownerPanelsByGroup: ReadonlyMap<string, readonly ExtensionSelectorPanel[]>;
  readonly pluginFeatures: ReadonlySet<string>;
  readonly secretQns: ReadonlySet<string>;
};

const NO_SELECTOR_GATING: SelectorGating = {
  pluginsByOwnerGroup: new Map(),
  ownerPanelsByGroup: new Map(),
  pluginFeatures: new Set(),
  secretQns: new Set(),
};

type HubContext = {
  readonly declaredTranslationKeys: ReadonlySet<string>;
  readonly selectorOptions: ReadonlyMap<string, readonly string[]>;
  readonly translationsByKey: ReadonlyMap<string, TranslationEntry>;
};

// Verbatim (unprefixed) keys as the client sees them — NOT getAllTranslations()
// (server-merged, "feature:"-prefixed, see build-app-schema.ts:77-81).
function collectDeclaredTranslations(registry: Registry): ReadonlyMap<string, TranslationEntry> {
  const declared = new Map<string, TranslationEntry>();
  for (const f of registry.features.values()) {
    for (const [key, values] of Object.entries(f.translations ?? {})) {
      if (!declared.has(key)) declared.set(key, values);
    }
  }
  return declared;
}

function collectSelectorOptions(registry: Registry): Map<string, readonly string[]> {
  const options = new Map<string, readonly string[]>();
  for (const [extensionName, selectorKey] of registry.getAllExtensionSelectors()) {
    const pluginIds = selectablePluginIds(registry, extensionName);
    if (pluginIds.length > 0) options.set(selectorKey, pluginIds);
  }
  return options;
}

function collectVisibleSelectorOwners(
  registry: Registry,
  visible: readonly ScopedKey[],
): { ownerGroupByExtension: Map<string, string>; selectorFeatures: Set<string> } {
  const ownerGroupByExtension = new Map<string, string>();
  const selectorFeatures = new Set<string>();
  for (const [extensionName, selectorKey] of registry.getAllExtensionSelectors()) {
    const selector = visible.find((v) => v.key.qn === selectorKey);
    if (selector === undefined) continue;
    ownerGroupByExtension.set(extensionName, selector.key.feature);
    selectorFeatures.add(selector.key.feature);
    selectorFeatures.add(selector.key.ownerFeature);
  }
  return { ownerGroupByExtension, selectorFeatures };
}

function collectOwnerPanelsByGroup(
  registry: Registry,
  ownerGroupByExtension: ReadonlyMap<string, string>,
): Map<string, ExtensionSelectorPanel[]> {
  const panelsByGroup = new Map<string, ExtensionSelectorPanel[]>();
  for (const [extension, ownerGroup] of [...ownerGroupByExtension].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const panels = registry.getExtensionSelectorPanels(extension);
    if (panels.length === 0) continue;
    panelsByGroup.set(ownerGroup, [...(panelsByGroup.get(ownerGroup) ?? []), ...panels]);
  }
  return panelsByGroup;
}

function countSelectorUsagesByFeature(registry: Registry): Map<string, number> {
  const usageCountByFeature = new Map<string, number>();
  for (const [extensionName] of registry.getAllExtensionSelectors()) {
    for (const usage of registry.getExtensionUsages(extensionName)) {
      if (usage.featureName === undefined) continue;
      const feature = toKebab(usage.featureName);
      usageCountByFeature.set(feature, (usageCountByFeature.get(feature) ?? 0) + 1);
    }
  }
  return usageCountByFeature;
}

// A plugin feature with several selector-gated registrations can't sit under one
// selector's panel, so it stays ungated (own nav, secrets in the global screen).
function planSelectorGating(
  registry: Registry,
  visible: readonly ScopedKey[],
  declaredSecrets: readonly DeclaredSecret[],
  secretsEnabled: boolean,
): SelectorGating {
  const { ownerGroupByExtension, selectorFeatures } = collectVisibleSelectorOwners(
    registry,
    visible,
  );
  if (ownerGroupByExtension.size === 0) return NO_SELECTOR_GATING;
  const usageCountByFeature = countSelectorUsagesByFeature(registry);

  const ownerPanelsByGroup = collectOwnerPanelsByGroup(registry, ownerGroupByExtension);
  // A selector with panels but no gated plugin still becomes a dashboard.
  const pluginsByOwnerGroup = new Map<string, GatedPlugin[]>(
    [...ownerPanelsByGroup.keys()].map((ownerGroup) => [ownerGroup, []]),
  );
  const pluginFeatures = new Set<string>();
  const secretQns = new Set<string>();
  for (const [extension, ownerGroup] of [...ownerGroupByExtension].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const usages = [...registry.getExtensionUsages(extension)].sort((a, b) =>
      (a.featureName ?? "").localeCompare(b.featureName ?? ""),
    );
    for (const usage of usages) {
      if (usage.featureName === undefined) continue;
      const feature = toKebab(usage.featureName);
      if (usageCountByFeature.get(feature) !== 1 || selectorFeatures.has(feature)) continue;
      const scopedKeys = visible.filter((v) => v.key.ownerFeature === feature);
      const secrets = secretsEnabled ? declaredSecrets.filter((s) => s.feature === feature) : [];
      if (scopedKeys.length === 0 && secrets.length === 0) continue;
      const plugins = pluginsByOwnerGroup.get(ownerGroup) ?? [];
      plugins.push({ feature, extension, pluginId: usage.entityName, scopedKeys, secrets });
      pluginsByOwnerGroup.set(ownerGroup, plugins);
      pluginFeatures.add(feature);
      for (const s of secrets) secretQns.add(s.qn);
    }
  }
  return { pluginsByOwnerGroup, ownerPanelsByGroup, pluginFeatures, secretQns };
}

type FeatureScreens = {
  screens: ScreenDefinition[];
  navs: NavDefinition[];
  translations: Record<string, TranslationEntry>;
};

// A tenant/user-home key with an elevated write role (SystemAdmin on a
// tenant key, see ELEVATED_ROLES) surfaces the SAME feature under two
// audience navs (cascade-default screen + home screen) — both would
// otherwise carry the identical `${feature}.settings` label. Opt-in
// scoped override (`${feature}.settings.${scope}`) disambiguates only
// where a feature actually declares one; every single-scope feature
// keeps the plain key unchanged.
function buildFeatureNav(
  scope: ConfigScope,
  feature: string,
  ordered: readonly MaskedKey[],
  access: AccessRule,
  declaredTranslationKeys: ReadonlySet<string>,
): NavDefinition {
  const shortId = `${feature}-${scope}`;
  const scopedLabel = `${feature}.settings.${scope}`;
  return {
    id: shortId,
    label: declaredTranslationKeys.has(scopedLabel) ? scopedLabel : `${feature}.settings`,
    parent: audienceNavShortId(scope),
    screen: shortId,
    icon: ordered[0]?.def.mask?.icon ?? "settings",
    order: minMaskOrder(ordered),
    access,
  };
}

// One configEdit screen + child-nav per feature; a tenant-scope selector owner
// becomes a dashboard instead and its gated plugins get no entries of their own.
function buildFeatureScreensAndNavs(
  scope: ConfigScope,
  visible: readonly ScopedKey[],
  hub: HubContext,
  gating: SelectorGating,
  secretsAccess: AccessRule | undefined,
): FeatureScreens {
  const out: FeatureScreens = { screens: [], navs: [], translations: {} };
  const ungated = visible.filter((v) => !gating.pluginFeatures.has(v.key.ownerFeature));
  for (const feature of featuresPresent(ungated.map((v) => v.key))) {
    const group = ungated.filter((v) => v.key.feature === feature);
    const ordered = sortByMaskOrder(group.map((v) => v.key));
    const access = rolesToAccess(group.flatMap((v) => v.roles));
    const shortId = `${feature}-${scope}`;
    const plugins = scope === "tenant" ? gating.pluginsByOwnerGroup.get(feature) : undefined;

    if (plugins === undefined) {
      out.screens.push(buildScreen(shortId, scope, feature, ordered, access, hub));
      out.navs.push(buildFeatureNav(scope, feature, ordered, access, hub.declaredTranslationKeys));
      continue;
    }
    const ownerHub = buildSelectorOwnerDashboard(
      feature,
      ordered,
      access,
      plugins,
      gating.ownerPanelsByGroup.get(feature) ?? [],
      hub,
      secretsAccess,
    );
    out.screens.push(...ownerHub.screens);
    out.navs.push(
      buildFeatureNav(scope, feature, ordered, ownerHub.access, hub.declaredTranslationKeys),
    );
    Object.assign(out.translations, ownerHub.translations);
  }
  return out;
}

function pluginTenantScreenId(plugin: GatedPlugin): string {
  return `${plugin.feature}-tenant`;
}

function assertUniquePanelIds(
  ownerGroup: string,
  panels: DashboardPanelDefinition[],
): DashboardPanelDefinition[] {
  const seen = new Set<string>();
  for (const panel of panels) {
    if (seen.has(panel.id)) {
      throw new Error(
        `Settings dashboard "${ownerGroup}-tenant" has duplicate panel id "${panel.id}" — an ` +
          `extensionSelector panel id collides with another panel of the same dashboard.`,
      );
    }
    seen.add(panel.id);
  }
  return panels;
}

// Plugin screens keep their `${F}-tenant` ids so consumer title keys stay valid;
// they are dormant because only this dashboard embeds them.
function buildSelectorOwnerDashboard(
  ownerGroup: string,
  ownerKeys: readonly MaskedKey[],
  ownerAccess: AccessRule,
  plugins: readonly GatedPlugin[],
  ownerPanels: readonly ExtensionSelectorPanel[],
  hub: HubContext,
  secretsAccess: AccessRule | undefined,
): {
  screens: ScreenDefinition[];
  access: AccessRule;
  translations: Record<string, TranslationEntry>;
} {
  const selectionScreenId = `${ownerGroup}-tenant-selection`;
  const selectionScreen: ConfigEditScreenDefinition = {
    ...buildScreen(selectionScreenId, "tenant", ownerGroup, ownerKeys, ownerAccess, hub, {
      description: EXTENSION_SELECTOR_HINT_KEY,
      sectionTitle: PROVIDER_SECTION_TITLE_KEY,
      submitLabel: SAVE_PROVIDER_LABEL_KEY,
    }),
    dormant: true,
  };
  const screens: ScreenDefinition[] = [selectionScreen];
  const configPanels: DashboardPanelDefinition[] = [];
  const secretsPanels: DashboardPanelDefinition[] = [];
  const accessRules: (AccessRule | undefined)[] = [ownerAccess];
  const translations: Record<string, TranslationEntry> = {};

  translations[`screen:${selectionScreenId}.title`] = PROVIDER_PANEL_TITLE_ENTRY;
  Object.assign(translations, providerOptionTranslations(selectionScreen, plugins, hub));

  for (const plugin of plugins) {
    const visibleWhen = {
      query: SELECTED_EXTENSIONS_QUERY,
      field: plugin.extension,
      eq: plugin.pluginId,
    };
    if (plugin.scopedKeys.length > 0) {
      const pluginAccess = rolesToAccess(plugin.scopedKeys.flatMap((v) => v.roles));
      const ordered = sortByMaskOrder(plugin.scopedKeys.map((v) => v.key));
      screens.push({
        ...buildScreen(
          pluginTenantScreenId(plugin),
          "tenant",
          plugin.feature,
          ordered,
          pluginAccess,
          hub,
          { description: null },
        ),
        dormant: true,
      });
      accessRules.push(pluginAccess);
      configPanels.push({
        kind: "screen",
        id: `${plugin.feature}-config`,
        screen: pluginTenantScreenId(plugin),
        visibleWhen,
        chromeless: true,
      });
    }
    if (plugin.secrets.length > 0) {
      const secretsScreenId = `${plugin.feature}-tenant-secrets`;
      const generated = buildSecretsEditScreen(
        secretsScreenId,
        plugin.secrets,
        secretsAccess,
        hub.declaredTranslationKeys,
      );
      screens.push({ ...generated.screen, dormant: true });
      Object.assign(translations, generated.translations);
      accessRules.push(secretsAccess);
      secretsPanels.push({
        kind: "screen",
        id: `${plugin.feature}-secrets`,
        screen: secretsScreenId,
        visibleWhen,
        chromeless: true,
      });
    }
  }

  const access = unionAccessRules(accessRules);
  const dashboard: DashboardScreenDefinition = {
    id: `${ownerGroup}-tenant`,
    type: "dashboard",
    showUpdatedAt: false,
    panels: assertUniquePanelIds(ownerGroup, [
      { kind: "screen", id: "selection", screen: selectionScreenId, chromeless: true },
      ...ownerPanels,
      ...configPanels,
      ...secretsPanels,
    ]),
    access,
  };
  return { screens: [dashboard, ...screens], access, translations };
}

// Everything generated for one audience scope: the audience-parent nav, the
// per-feature configEdit screens+navs, and (tenant-scope only, when secrets
// are enabled) the secrets screen. Null when nothing is visible at this scope.
function buildScopeResult(
  scope: ConfigScope,
  masked: readonly MaskedKey[],
  secretsEnabled: boolean,
  secretsWriteHandler: ReturnType<Registry["getWriteHandler"]>,
  declaredSecrets: readonly DeclaredSecret[],
  hub: HubContext,
  registry: Registry,
): ScopeResult | null {
  const visible = scopedKeysAt(masked, scope);
  // Secrets attach to the tenant-audience nav regardless of whether any
  // config key is visible there — they alone must be enough to open it.
  const includeSecrets = secretsEnabled && scope === "tenant";
  if (visible.length === 0 && !includeSecrets) return null;

  const configAccess = rolesToAccess(visible.flatMap((v) => v.roles));
  const secretsAccess = secretsWriteHandler?.access;
  const gating =
    scope === "tenant"
      ? planSelectorGating(registry, visible, declaredSecrets, secretsEnabled)
      : NO_SELECTOR_GATING;
  const screens: ScreenDefinition[] = [];
  const navs: NavDefinition[] = [];
  // Audience-Parent: Gruppierungs-Knoten ohne Screen.
  navs.push({
    id: audienceNavShortId(scope),
    label: `config.settings.${scope}`,
    icon: SCOPE_ICON[scope],
    order: SCOPE_ORDER[scope],
    access: includeSecrets ? unionAccessRules([configAccess, secretsAccess]) : configAccess,
  });

  const perFeature = buildFeatureScreensAndNavs(scope, visible, hub, gating, secretsAccess);
  screens.push(...perFeature.screens);
  navs.push(...perFeature.navs);

  const translations: Record<string, TranslationEntry> = {
    ...perFeature.translations,
  };
  const globalSecrets = declaredSecrets.filter((s) => !gating.secretQns.has(s.qn));
  if (includeSecrets && globalSecrets.length > 0) {
    const generated = buildSecretsScreen(globalSecrets, secretsAccess, hub.declaredTranslationKeys);
    screens.push(generated.screen);
    navs.push(generated.nav);
    Object.assign(translations, generated.translations);
  }

  return {
    screens,
    navs,
    ...(Object.keys(translations).length > 0 && { translations }),
  };
}

export function buildConfigFeatureSchema(registry: Registry): ConfigFeatureSchema {
  const masked = collectMaskedKeys(registry);
  const declaredSecrets = collectDeclaredSecrets(registry);
  // The `secrets` feature must actually be mounted (its set-handler
  // registered) for a declared `r.secret()` to have anywhere to write to.
  const secretsWriteHandler = registry.getWriteHandler("secrets:write:set");
  const secretsEnabled = secretsWriteHandler !== undefined && declaredSecrets.length > 0;
  if (masked.length === 0 && !secretsEnabled) return { screens: [], navs: [] };

  const translationsByKey = collectDeclaredTranslations(registry);
  const hub: HubContext = {
    declaredTranslationKeys: new Set(translationsByKey.keys()),
    selectorOptions: collectSelectorOptions(registry),
    translationsByKey,
  };

  const screens: ScreenDefinition[] = [];
  const navs: NavDefinition[] = [];
  let translations: TranslationKeys | undefined;

  for (const scope of SCOPES_BROAD_TO_DEEP) {
    const result = buildScopeResult(
      scope,
      masked,
      secretsEnabled,
      secretsWriteHandler,
      declaredSecrets,
      hub,
      registry,
    );
    if (result === null) continue;
    screens.push(...result.screens);
    navs.push(...result.navs);
    if (result.translations !== undefined) {
      translations = { ...translations, ...result.translations };
    }
  }

  // Every masked key machine-only and no secrets → no human hub, and no
  // (empty) settings switcher.
  if (navs.length === 0) return { screens, navs };
  return {
    screens,
    navs,
    workspace: buildSettingsWorkspace(navs),
    ...(translations !== undefined && { translations }),
  };
}

type DeclaredSecret = {
  readonly qn: string;
  readonly feature: string;
  readonly shortKey: string;
  readonly def: SecretKeyDefinition;
};

function collectDeclaredSecrets(registry: Registry): DeclaredSecret[] {
  const out: DeclaredSecret[] = [];
  for (const [qn, def] of registry.getAllSecretKeys()) {
    const sep = qn.indexOf(":secret:");
    if (sep === -1) continue;
    out.push({
      qn,
      feature: qn.slice(0, sep),
      shortKey: qn.slice(sep + ":secret:".length),
      def,
    });
  }
  return out.sort(
    (a, b) => a.feature.localeCompare(b.feature) || a.shortKey.localeCompare(b.shortKey),
  );
}

// One screen for ALL declared secrets (not one per feature — a per-feature
// nav would collide with the same feature's configEdit nav under
// audience-tenant). `access` mirrors the secrets `set`-handler's own access
// rule verbatim so a screen never permits more than the handler itself does.
function buildSecretsScreen(
  secrets: readonly DeclaredSecret[],
  access: AccessRule | undefined,
  declaredTranslationKeys: ReadonlySet<string>,
): { screen: SecretsEditScreenDefinition; nav: NavDefinition; translations: TranslationKeys } {
  const { screen, translations } = buildSecretsEditScreen(
    "secrets",
    secrets,
    access,
    declaredTranslationKeys,
  );
  const nav: NavDefinition = {
    id: "secrets",
    label: "config.secrets.title",
    parent: audienceNavShortId("tenant"),
    screen: "secrets",
    icon: "key",
    order: 900,
    ...(access !== undefined && { access }),
  };
  return { screen, nav, translations };
}

function buildSecretsEditScreen(
  screenId: string,
  secrets: readonly DeclaredSecret[],
  access: AccessRule | undefined,
  declaredTranslationKeys: ReadonlySet<string>,
): { screen: SecretsEditScreenDefinition; translations: TranslationKeys } {
  const secretKeys: Record<string, string> = {};
  const fieldLabels: Record<string, string> = {};
  const fieldHints: Record<string, string> = {};
  const requiredFields: string[] = [];
  // Mutable outer record — TranslationKeys' Readonly<Record<...>> index
  // signature only permits reading, so the top-level assignments below
  // need a writable local type; each entry is still a fresh, never-mutated object.
  const translations: Record<string, TranslationEntry> = {};
  const sections: SecretsEditSection[] = [];

  for (const feature of [...new Set(secrets.map((s) => s.feature))]) {
    const fieldIds: string[] = [];
    for (const s of secrets.filter((v) => v.feature === feature)) {
      const fieldId = `${s.feature}-${s.shortKey}`;
      fieldIds.push(fieldId);
      secretKeys[fieldId] = s.qn;
      const labelKey = `config.secret.${s.feature}.${s.shortKey}.label`;
      fieldLabels[fieldId] = labelKey;
      translations[labelKey] = { ...s.def.label };
      if (s.def.hint !== undefined) {
        const hintKey = `config.secret.${s.feature}.${s.shortKey}.hint`;
        fieldHints[fieldId] = hintKey;
        translations[hintKey] = { ...s.def.hint };
      }
      if (s.def.required === true) requiredFields.push(fieldId);
    }
    const titleKey = `${feature}.settings`;
    sections.push({
      ...(declaredTranslationKeys.has(titleKey) && { title: titleKey }),
      fields: fieldIds,
    });
  }

  const screen: SecretsEditScreenDefinition = {
    id: screenId,
    type: "secretsEdit",
    secretKeys,
    fieldLabels,
    ...(Object.keys(fieldHints).length > 0 && { fieldHints }),
    ...(requiredFields.length > 0 && { requiredFields }),
    sections,
    ...(access !== undefined && { access }),
  };
  return { screen, translations };
}

// Keys visible at `scope`, paired with their effective write roles AT that
// scope (Home = full write; broader = elevated ∩ write).
function scopedKeysAt(masked: readonly MaskedKey[], scope: ConfigScope): ScopedKey[] {
  const out: ScopedKey[] = [];
  for (const key of masked) {
    const roles = effectiveWriteRoles(key.def, scope);
    // Strip MACHINE_WRITE_ROLE from the screen roles: a mixed write set
    // (e.g. ["system", "SystemAdmin"]) must not leak "system" into the
    // screen access gate — mirrors the machine-filtered workspace gate.
    const humanRoles = roles.filter((r) => r !== MACHINE_WRITE_ROLE);
    if (humanRoles.length > 0) out.push({ key, roles: humanRoles });
  }
  return out;
}

function effectiveWriteRoles(def: ConfigKeyDefinition, scope: ConfigScope): string[] {
  if (SCOPE_ORDER[scope] > SCOPE_ORDER[def.scope]) return [];
  if (scope === def.scope) return [...def.access.write];
  const elevated = ELEVATED_ROLES[scope];
  return def.access.write.filter((r) => elevated.includes(r));
}

// navMembers tragen die QUALIFIZIERTEN Nav-QNs (siehe build-app-schema.test:
// admin.navMembers === ["orders:nav:list", ...]). Die generierten Navs leben
// unter SETTINGS_HUB_FEATURE, also `config:nav:<shortId>`. Sortiert = stabile
// Landing-Screen-Wahl (firstNavScreenId iteriert navMembers der Reihe nach).
function buildSettingsWorkspace(navs: readonly NavDefinition[]): WorkspaceSchema {
  const navMembers = navs.map((n) => `${SETTINGS_HUB_FEATURE}:nav:${n.id}`).sort();
  return {
    definition: {
      id: SETTINGS_HUB_WORKSPACE,
      label: "config.settings.title",
      icon: "settings",
      order: 1000,
      // Union der Zugriffs-Regeln der bereits generierten (machine-gefilterten)
      // Hub-Navs — sonst sieht ein unprivilegierter User einen leeren
      // "Settings"-Switcher. Aus den Navs statt aus `masked`, damit die
      // machine-only "system"-Rolle (die in keinem Nav steht) nicht ins
      // Switcher-Gate leakt.
      access: unionAccessRules(navs.map((n) => n.access)),
    },
    navMembers,
  };
}

function buildScreen(
  shortId: string,
  scope: ConfigScope,
  feature: string,
  keys: readonly MaskedKey[],
  access: AccessRule,
  hub: HubContext,
  options: ScreenOptions = {},
): ConfigEditScreenDefinition {
  const configKeys: Record<string, string> = {};
  const fields: Record<string, FieldDefinition> = {};
  const fieldLabels: Record<string, string> = {};
  const fieldDescriptions: Record<string, string> = {};
  const requiredFields: string[] = [];
  // Field id collapses to the plain shortKey when the key stays in its own
  // feature's group (100% of today's apps — byte-identical output). Only a
  // cross-feature `group` (feature !== ownerFeature) needs the owner prefix,
  // to keep two features sharing a group from clobbering the same shortKey.
  const fieldId = (k: MaskedKey): string =>
    k.feature === k.ownerFeature ? k.shortKey : `${k.ownerFeature}-${k.shortKey}`;
  const seenFieldIds = new Map<string, string>();
  for (const k of keys) {
    const id = fieldId(k);
    const prevQn = seenFieldIds.get(id);
    if (prevQn !== undefined) {
      throw new Error(
        `[Settings-Hub] group "${feature}" scope "${scope}": config keys "${prevQn}" and "${k.qn}" both resolve to field id "${id}" — rename one key or its group.`,
      );
    }
    seenFieldIds.set(id, k.qn);
    configKeys[id] = k.qn;
    fields[id] = deriveField(k, hub.selectorOptions.get(k.qn), keys, fieldId);
    // mask is the visibility gate, so collectMaskedKeys guarantees it here.
    if (k.def.mask) fieldLabels[id] = k.def.mask.title;
    if (k.def.mask?.description !== undefined) fieldDescriptions[id] = k.def.mask.description;
    if (k.def.required === true) requiredFields.push(id);
  }
  const { section, screenDescription } = buildSettingsSection(
    feature,
    scope,
    keys.map(fieldId),
    hub,
    options,
  );
  return {
    id: shortId,
    type: "configEdit",
    scope,
    configKeys,
    fields,
    fieldLabels,
    ...(Object.keys(fieldDescriptions).length > 0 && { fieldDescriptions }),
    ...(requiredFields.length > 0 && { requiredFields }),
    ...(screenDescription !== undefined && { description: screenDescription }),
    ...(options.submitLabel !== undefined && { submitLabel: options.submitLabel }),
    layout: { sections: [section], width: "full", variant: "settings-list" },
    access,
  };
}

// `{ field: <shortKey> }` names another key of the owner feature; on the form it
// has to point at that key's generated field id, so it must sit on the same mask.
function rewriteOptionsQueryFieldRefs(
  key: MaskedKey,
  payload: OptionsQueryPayload,
  screenKeys: readonly MaskedKey[],
  fieldIdOf: (k: MaskedKey) => string,
): OptionsQueryPayload {
  return Object.fromEntries(
    Object.entries(payload).map(([name, value]) => {
      if (!isOptionsQueryFieldRef(value)) return [name, value];
      const target = screenKeys.find(
        (k) => k.ownerFeature === key.ownerFeature && k.shortKey === toKebab(value.field),
      );
      if (target === undefined) {
        throw new Error(
          `[Settings-Hub] config key "${key.qn}" optionsQueryPayload "${name}" references key "${value.field}", which is not on the same generated settings screen (group "${key.feature}") — give both keys the same group, scope and a mask.`,
        );
      }
      return [name, { field: fieldIdOf(target) }];
    }),
  );
}

function buildSettingsSection(
  feature: string,
  scope: ConfigScope,
  fieldIds: readonly string[],
  hub: HubContext,
  options: ScreenOptions,
): { readonly section: EditFieldsSection; readonly screenDescription: string | undefined } {
  // translate() echoes an undeclared key, so an ungated description would render raw.
  const descriptionKey = `${feature}.settings.description`;
  const featureDescription = hub.declaredTranslationKeys.has(descriptionKey)
    ? descriptionKey
    : undefined;
  const audienceDescription =
    options.description === null
      ? undefined
      : (options.description ?? audienceDescriptionKey(scope));
  // The section's header column holds one sentence: the feature's own, else the
  // audience one. When both exist the audience sentence stays on the screen.
  const sectionDescription = featureDescription ?? audienceDescription;
  const screenDescription = featureDescription !== undefined ? audienceDescription : undefined;
  // A feature whose page title equals its `<feature>.settings` label would have
  // the section heading dropped as a duplicate; `.settings.section` lets it
  // declare a distinct heading.
  const sectionKey = `${feature}.settings.section`;
  const section: EditFieldsSection = {
    title:
      options.sectionTitle ??
      (hub.declaredTranslationKeys.has(sectionKey) ? sectionKey : `${feature}.settings`),
    ...(sectionDescription !== undefined && { description: sectionDescription }),
    fields: fieldIds,
  };
  return { section, screenDescription };
}

// description: undefined → the audience sentence, null → none (screen embedded in a dashboard panel).
type ScreenOptions = {
  readonly description?: string | null;
  readonly sectionTitle?: string;
  readonly submitLabel?: string;
};

// Option labels of the provider select: each plugin feature's `<feature>.settings`
// copy, under the option-label key the configEdit renderer already derives.
function providerOptionTranslations(
  selectionScreen: ConfigEditScreenDefinition,
  plugins: readonly GatedPlugin[],
  hub: HubContext,
): Record<string, TranslationEntry> {
  const out: Record<string, TranslationEntry> = {};
  for (const [fieldId, qn] of Object.entries(selectionScreen.configKeys)) {
    if (!hub.selectorOptions.has(qn)) continue;
    for (const plugin of plugins) {
      const label = hub.translationsByKey.get(`${plugin.feature}.settings`);
      if (label === undefined) continue;
      const key = `${fieldLabelKey(SETTINGS_HUB_FEATURE, CONFIG_EDIT_ENTITY, fieldId)}:option:${plugin.pluginId}`;
      out[key] = label;
    }
  }
  return out;
}

function deriveField(
  key: MaskedKey,
  selectorPluginIds: readonly string[] | undefined,
  screenKeys: readonly MaskedKey[],
  fieldIdOf: (k: MaskedKey) => string,
): FieldDefinition {
  const def = key.def;
  if (selectorPluginIds !== undefined) return createSelectField({ options: selectorPluginIds });
  switch (def.type) {
    case "number":
      return createNumberField({
        ...(def.bounds?.min !== undefined && { min: def.bounds.min }),
        ...(def.bounds?.max !== undefined && { max: def.bounds.max }),
      });
    case "boolean":
      return createBooleanField();
    case "select":
      if (def.optionsQuery !== undefined) {
        return createSelectField({
          options: [],
          optionsQuery: def.optionsQuery,
          ...(def.optionsQueryPayload !== undefined && {
            optionsQueryPayload: rewriteOptionsQueryFieldRefs(
              key,
              def.optionsQueryPayload,
              screenKeys,
              fieldIdOf,
            ),
          }),
        });
      }
      return def.options !== undefined && def.options.length > 0
        ? createSelectField({ options: def.options })
        : createTextField({ personal: false, reason: "system_metadata" });
    default:
      // A stored secret never goes back to the client: the form shows set/empty
      // and sends only a replacement or a clear.
      return createTextField({
        personal: false,
        reason: "system_metadata",
        ...(def.type === "text" && isEncryptedAtRest(def) && { writeOnly: true }),
      });
  }
}

function collectMaskedKeys(registry: Registry): MaskedKey[] {
  const out: MaskedKey[] = [];
  for (const [qn, def] of registry.getAllConfigKeys()) {
    const sep = qn.indexOf(":config:");
    if (sep === -1) continue;
    const ownerFeature = qn.slice(0, sep);
    if (def.group !== undefined && !isKebabSegment(def.group)) {
      throw new Error(
        `[Feature ${ownerFeature}] config key "${qn.slice(sep + ":config:".length)}" has invalid group "${def.group}" — must be kebab-case.`,
      );
    }
    // computed keys derive their value — there is no row to set, so a
    // configEdit screen could not write them. Skip even when masked.
    if (def.mask === undefined || def.computed !== undefined) continue;
    out.push({
      qn,
      feature: def.group ?? ownerFeature,
      ownerFeature,
      shortKey: qn.slice(sep + ":config:".length),
      def,
    });
  }
  return out;
}

function featuresPresent(keys: readonly MaskedKey[]): string[] {
  return [...new Set(keys.map((k) => k.feature))].sort();
}

function sortByMaskOrder(keys: readonly MaskedKey[]): MaskedKey[] {
  return [...keys].sort(
    (a, b) => maskOrder(a) - maskOrder(b) || a.shortKey.localeCompare(b.shortKey),
  );
}

function maskOrder(k: MaskedKey): number {
  return k.def.mask?.order ?? 0;
}

function minMaskOrder(keys: readonly MaskedKey[]): number {
  return Math.min(...keys.map(maskOrder));
}

// Der Hub ist zum Editieren — wer mindestens einen Key der Gruppe SCHREIBEN
// darf, sieht den Settings-Eintrag (write, nicht read). Das hält system-scope
// (write default `["system"]`) human-hidden bis der Autor write: SystemAdmin
// opt-int, und zeigt user-scope (write `all`) jedem. `all` lässt sich in
// AccessRule nur als openToAll ausdrücken; der Write bleibt server-seitig
// per Key gegated.
// Union der Navs-Access-Regeln: ein openToAll-Nav öffnet das ganze Gate, sonst
// die Vereinigung der Rollen. undefined-access-Navs tragen nichts bei.
function unionAccessRules(rules: readonly (AccessRule | undefined)[]): AccessRule {
  const roles: string[] = [];
  for (const rule of rules) {
    if (rule === undefined) continue;
    if ("openToAll" in rule) {
      if (isOpenToAllGranted(rule)) return rule;
      continue;
    }
    roles.push(...rule.roles);
  }
  return rolesToAccess(roles);
}

// `all` lässt sich in AccessRule nur als openToAll ausdrücken; der Write bleibt
// server-seitig per Key gegated.
function rolesToAccess(roles: readonly string[]): AccessRule {
  if (roles.includes("all"))
    return {
      openToAll: {
        reason:
          'config key declares the "all" role, so every signed-in user of the tenant may read/write it',
      },
    };
  return { roles: [...new Set(roles)] };
}
