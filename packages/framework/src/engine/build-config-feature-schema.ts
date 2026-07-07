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
import type { ConfigKeyDefinition } from "./types/config";
import type { Registry } from "./types/feature";
import type { FieldDefinition } from "./types/fields";
import type { AccessRule } from "./types/handlers";
import type { NavDefinition } from "./types/nav";
import type {
  ConfigEditScreenDefinition,
  EditFieldsSection,
  ScreenDefinition,
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
};

// Audience-Reihenfolge im Sidebar: Plattform vor Tenant vor Benutzer.
const SCOPE_ORDER: Record<ConfigScope, number> = { system: 10, tenant: 20, user: 30 };
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
  readonly feature: string;
  readonly shortKey: string;
  readonly def: ConfigKeyDefinition;
};

type ScopedKey = { readonly key: MaskedKey; readonly roles: readonly string[] };

export function buildConfigFeatureSchema(registry: Registry): ConfigFeatureSchema {
  const masked = collectMaskedKeys(registry);
  if (masked.length === 0) return { screens: [], navs: [] };

  const screens: ScreenDefinition[] = [];
  const navs: NavDefinition[] = [];

  for (const scope of SCOPES_BROAD_TO_DEEP) {
    const visible = scopedKeysAt(masked, scope);
    if (visible.length === 0) continue;

    // Audience-Parent: Gruppierungs-Knoten ohne Screen.
    navs.push({
      id: audienceNavShortId(scope),
      label: `config.settings.${scope}`,
      order: SCOPE_ORDER[scope],
      access: rolesToAccess(visible.flatMap((v) => v.roles)),
    });

    for (const feature of featuresPresent(visible.map((v) => v.key))) {
      const group = visible.filter((v) => v.key.feature === feature);
      const ordered = sortByMaskOrder(group.map((v) => v.key));
      const access = rolesToAccess(group.flatMap((v) => v.roles));
      const shortId = `${feature}-${scope}`;

      screens.push(buildScreen(shortId, scope, feature, ordered, access));
      navs.push({
        id: shortId,
        label: `${feature}.settings`,
        parent: audienceNavShortId(scope),
        screen: shortId,
        icon: ordered[0]?.def.mask?.icon ?? "settings",
        order: minMaskOrder(ordered),
        access,
      });
    }
  }

  // Alle masked Keys maschinen-only → kein menschlicher Hub, kein (leerer)
  // Settings-Switcher.
  if (navs.length === 0) return { screens, navs };
  return { screens, navs, workspace: buildSettingsWorkspace(navs) };
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
): ConfigEditScreenDefinition {
  const configKeys: Record<string, string> = {};
  const fields: Record<string, FieldDefinition> = {};
  const fieldLabels: Record<string, string> = {};
  for (const k of keys) {
    configKeys[k.shortKey] = k.qn;
    fields[k.shortKey] = deriveField(k.def);
    // mask is the visibility gate, so collectMaskedKeys guarantees it here.
    if (k.def.mask) fieldLabels[k.shortKey] = k.def.mask.title;
  }
  const section: EditFieldsSection = {
    title: `${feature}.settings`,
    fields: keys.map((k) => k.shortKey),
  };
  return {
    id: shortId,
    type: "configEdit",
    scope,
    configKeys,
    fields,
    fieldLabels,
    layout: { sections: [section] },
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
    // computed keys derive their value — there is no row to set, so a
    // configEdit screen could not write them. Skip even when masked.
    if (def.mask === undefined || def.computed !== undefined) continue;
    const sep = qn.indexOf(":config:");
    if (sep === -1) continue;
    out.push({
      qn,
      feature: qn.slice(0, sep),
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
