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

export type ConfigFeatureSchema = {
  readonly screens: readonly ScreenDefinition[];
  readonly navs: readonly NavDefinition[];
};

// Audience-Reihenfolge im Sidebar: Plattform vor Tenant vor Benutzer.
const SCOPE_ORDER: Record<ConfigScope, number> = { system: 10, tenant: 20, user: 30 };

type MaskedKey = {
  readonly qn: string;
  readonly feature: string;
  readonly shortKey: string;
  readonly def: ConfigKeyDefinition;
};

export function buildConfigFeatureSchema(registry: Registry): ConfigFeatureSchema {
  const masked = collectMaskedKeys(registry);
  if (masked.length === 0) return { screens: [], navs: [] };

  const screens: ScreenDefinition[] = [];
  const navs: NavDefinition[] = [];

  for (const scope of scopesPresent(masked)) {
    const scopeKeys = masked.filter((k) => k.def.scope === scope);

    // Audience-Parent: Gruppierungs-Knoten ohne Screen.
    navs.push({
      id: `audience-${scope}`,
      label: `config.settings.${scope}`,
      order: SCOPE_ORDER[scope],
      access: unionEditAccess(scopeKeys.map((k) => k.def)),
    });

    for (const feature of featuresPresent(scopeKeys)) {
      const group = scopeKeys.filter((k) => k.feature === feature);
      const ordered = sortByMaskOrder(group);
      const shortId = `${feature}-${scope}`;

      screens.push(buildScreen(shortId, scope, feature, ordered));
      navs.push({
        id: shortId,
        label: `${feature}.settings`,
        parent: `audience-${scope}`,
        screen: shortId,
        order: minMaskOrder(group),
        access: unionEditAccess(group.map((k) => k.def)),
      });
    }
  }

  return { screens, navs };
}

function buildScreen(
  shortId: string,
  scope: ConfigScope,
  feature: string,
  keys: readonly MaskedKey[],
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
    access: unionEditAccess(keys.map((k) => k.def)),
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

function scopesPresent(keys: readonly MaskedKey[]): ConfigScope[] {
  const set = new Set<ConfigScope>(keys.map((k) => k.def.scope));
  return [...set].sort((a, b) => (SCOPE_ORDER[a] ?? 0) - (SCOPE_ORDER[b] ?? 0));
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
function unionEditAccess(defs: readonly ConfigKeyDefinition[]): AccessRule {
  const roles = new Set<string>();
  for (const def of defs) {
    for (const role of def.access.write) roles.add(role);
  }
  if (roles.has("all")) return { openToAll: true };
  return { roles: [...roles] };
}
