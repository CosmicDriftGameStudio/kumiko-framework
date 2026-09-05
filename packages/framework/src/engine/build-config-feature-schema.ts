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

import type { WorkspaceSchema } from "../ui-types";
import type { ConfigScope } from "./constants";
import {
  createBooleanField,
  createNumberField,
  createSelectField,
  createTextField,
} from "./factories";
import { isKebabSegment } from "./qualified-name";
import type { ConfigKeyDefinition, TranslationKeys } from "./types/config";
import type { Registry, SecretKeyDefinition } from "./types/feature";
import type { FieldDefinition } from "./types/fields";
import type { AccessRule } from "./types/handlers";
import type { NavDefinition, NavIconKey } from "./types/nav";
import type {
  ConfigEditScreenDefinition,
  EditFieldsSection,
  ScreenDefinition,
  SecretsEditScreenDefinition,
  SecretsEditSection,
} from "./types/screen";

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

// Verbatim (unprefixed) keys as the client sees them — NOT getAllTranslations()
// (server-merged, "feature:"-prefixed, see build-app-schema.ts:77-81).
function collectDeclaredTranslationKeys(registry: Registry): Set<string> {
  const declaredTranslationKeys = new Set<string>();
  for (const f of registry.features.values()) {
    for (const key of Object.keys(f.translations ?? {})) declaredTranslationKeys.add(key);
  }
  return declaredTranslationKeys;
}

// Per-feature configEdit screen + child-nav, one pair per feature present in
// `visible` at this scope.
function buildFeatureScreensAndNavs(
  scope: ConfigScope,
  visible: readonly ScopedKey[],
  declaredTranslationKeys: ReadonlySet<string>,
): { screens: ScreenDefinition[]; navs: NavDefinition[] } {
  const screens: ScreenDefinition[] = [];
  const navs: NavDefinition[] = [];
  for (const feature of featuresPresent(visible.map((v) => v.key))) {
    const group = visible.filter((v) => v.key.feature === feature);
    const ordered = sortByMaskOrder(group.map((v) => v.key));
    const access = rolesToAccess(group.flatMap((v) => v.roles));
    const shortId = `${feature}-${scope}`;

    screens.push(buildScreen(shortId, scope, feature, ordered, access, declaredTranslationKeys));
    // A tenant/user-home key with an elevated write role (SystemAdmin on a
    // tenant key, see ELEVATED_ROLES) surfaces the SAME feature under two
    // audience navs (cascade-default screen + home screen) — both would
    // otherwise carry the identical `${feature}.settings` label. Opt-in
    // scoped override (`${feature}.settings.${scope}`) disambiguates only
    // where a feature actually declares one; every single-scope feature
    // keeps the plain key unchanged.
    const scopedLabel = `${feature}.settings.${scope}`;
    navs.push({
      id: shortId,
      label: declaredTranslationKeys.has(scopedLabel) ? scopedLabel : `${feature}.settings`,
      parent: audienceNavShortId(scope),
      screen: shortId,
      icon: ordered[0]?.def.mask?.icon ?? "settings",
      order: minMaskOrder(ordered),
      access,
    });
  }
  return { screens, navs };
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
  declaredTranslationKeys: ReadonlySet<string>,
): ScopeResult | null {
  const visible = scopedKeysAt(masked, scope);
  // Secrets attach to the tenant-audience nav regardless of whether any
  // config key is visible there — they alone must be enough to open it.
  const includeSecrets = secretsEnabled && scope === "tenant";
  if (visible.length === 0 && !includeSecrets) return null;

  const configAccess = rolesToAccess(visible.flatMap((v) => v.roles));
  const secretsAccess = secretsWriteHandler?.access;
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

  const perFeature = buildFeatureScreensAndNavs(scope, visible, declaredTranslationKeys);
  screens.push(...perFeature.screens);
  navs.push(...perFeature.navs);

  let translations: TranslationKeys | undefined;
  if (includeSecrets) {
    const generated = buildSecretsScreen(declaredSecrets, secretsAccess, declaredTranslationKeys);
    screens.push(generated.screen);
    navs.push(generated.nav);
    translations = generated.translations;
  }

  return { screens, navs, ...(translations !== undefined && { translations }) };
}

export function buildConfigFeatureSchema(registry: Registry): ConfigFeatureSchema {
  const masked = collectMaskedKeys(registry);
  const declaredSecrets = collectDeclaredSecrets(registry);
  // The `secrets` feature must actually be mounted (its set-handler
  // registered) for a declared `r.secret()` to have anywhere to write to.
  const secretsWriteHandler = registry.getWriteHandler("secrets:write:set");
  const secretsEnabled = secretsWriteHandler !== undefined && declaredSecrets.length > 0;
  if (masked.length === 0 && !secretsEnabled) return { screens: [], navs: [] };

  const declaredTranslationKeys = collectDeclaredTranslationKeys(registry);

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
      declaredTranslationKeys,
    );
    if (result === null) continue;
    screens.push(...result.screens);
    navs.push(...result.navs);
    if (result.translations !== undefined) translations = result.translations;
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
  const secretKeys: Record<string, string> = {};
  const fieldLabels: Record<string, string> = {};
  const fieldHints: Record<string, string> = {};
  const requiredFields: string[] = [];
  // Mutable outer record — TranslationKeys' Readonly<Record<...>> index
  // signature only permits reading, so the top-level assignments below
  // need a writable local type; each entry is still a fresh, never-mutated object.
  const translations: Record<string, Readonly<Record<string, string>>> = {};
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
    id: "secrets",
    type: "secretsEdit",
    secretKeys,
    fieldLabels,
    ...(Object.keys(fieldHints).length > 0 && { fieldHints }),
    ...(requiredFields.length > 0 && { requiredFields }),
    sections,
    ...(access !== undefined && { access }),
  };
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
  declaredTranslationKeys: ReadonlySet<string>,
): ConfigEditScreenDefinition {
  const configKeys: Record<string, string> = {};
  const fields: Record<string, FieldDefinition> = {};
  const fieldLabels: Record<string, string> = {};
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
    fields[id] = deriveField(k.def);
    // mask is the visibility gate, so collectMaskedKeys guarantees it here.
    if (k.def.mask) fieldLabels[id] = k.def.mask.title;
  }
  // translate() echoes an undeclared key, so an ungated description would render raw.
  const descriptionKey = `${feature}.settings.description`;
  const section: EditFieldsSection = {
    title: `${feature}.settings`,
    ...(declaredTranslationKeys.has(descriptionKey) && { description: descriptionKey }),
    fields: keys.map(fieldId),
  };
  return {
    id: shortId,
    type: "configEdit",
    scope,
    configKeys,
    fields,
    fieldLabels,
    layout: { sections: [section], width: "full" },
    access,
  };
}

function deriveField(def: ConfigKeyDefinition): FieldDefinition {
  switch (def.type) {
    case "number":
      return createNumberField();
    case "boolean":
      return createBooleanField();
    case "select":
      return def.options !== undefined && def.options.length > 0
        ? createSelectField({ options: def.options })
        : createTextField();
    default:
      return createTextField();
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
    if ("openToAll" in rule) return { openToAll: true };
    roles.push(...rule.roles);
  }
  return rolesToAccess(roles);
}

// `all` lässt sich in AccessRule nur als openToAll ausdrücken; der Write bleibt
// server-seitig per Key gegated.
function rolesToAccess(roles: readonly string[]): AccessRule {
  if (roles.includes("all")) return { openToAll: true };
  return { roles: [...new Set(roles)] };
}
