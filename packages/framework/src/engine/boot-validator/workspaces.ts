// Workspace validation.

import { SETTINGS_HUB_AUDIENCE_NAV_QNS } from "../build-config-feature-schema";
import { qualifyEntityName } from "../qualified-name";
import type { FeatureDefinition, NavDefinition, WorkspaceDefinition } from "../types";

// --- Workspace validation ---
//
// Per-app workspace registry, built once up front. Carries `featureName`
// alongside the definition so error messages can point at the offending
// feature without a parallel reverse index.

export function collectWorkspaceQns(
  features: readonly FeatureDefinition[],
): Map<string, WorkspaceDefinition & { readonly featureName: string }> {
  const map = new Map<string, WorkspaceDefinition & { readonly featureName: string }>();
  for (const f of features) {
    for (const [wsId, wsDef] of Object.entries(f.workspaces)) {
      const qualified = qualifyEntityName(f.name, "workspace", wsId);
      map.set(qualified, { ...wsDef, featureName: f.name });
    }
  }
  return map;
}

export function validateWorkspaces(
  feature: FeatureDefinition,
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
): void {
  for (const [wsId, wsDef] of Object.entries(feature.workspaces)) {
    if (wsDef.nav !== undefined) {
      for (const navQn of wsDef.nav) {
        // Settings-Hub audience navs are generated post-boot (buildAppSchema), never via r.nav() — exempt so an inline-placement reference doesn't trip the boot validator.
        if (SETTINGS_HUB_AUDIENCE_NAV_QN_SET.has(navQn)) continue;
        if (!allNavQns.has(navQn)) {
          throw new Error(
            `[Feature ${feature.name}] Workspace "${wsId}" references nav "${navQn}" ` +
              `which is not registered. Expected a qualified name of the form ` +
              `"<feature>:nav:<id>" pointing at an r.nav() declaration.`,
          );
        }
      }
    }
  }
}

const SETTINGS_HUB_AUDIENCE_NAV_QN_SET: ReadonlySet<string> = new Set(
  SETTINGS_HUB_AUDIENCE_NAV_QNS,
);

// fw#3019: apps that assign navs to workspaces via `r.workspace({ nav })`
// or `r.nav({ workspaces })` never pass an explicit navAllowlist (solon#113)
// — without this, warnOnUnreachableNavScreens never runs for them. Both
// `WorkspaceDefinition.nav` and `NavDefinition.workspaces` already hold
// fully-qualified QNs (validateWorkspaces/validateNavs compare them
// directly against allNavQns/allWorkspaceQns), so no re-qualification is
// needed here.
export function deriveNavAllowlistFromWorkspaces(
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
  allWorkspaceQns: ReadonlyMap<string, WorkspaceDefinition & { readonly featureName: string }>,
): ReadonlySet<string> {
  const allowlist = new Set<string>();
  for (const wsDef of allWorkspaceQns.values()) {
    for (const navQn of wsDef.nav ?? []) {
      allowlist.add(navQn);
    }
  }
  for (const [navQn, navDef] of allNavQns) {
    if (navDef.workspaces !== undefined && navDef.workspaces.length > 0) {
      allowlist.add(navQn);
    }
  }
  return allowlist;
}

// App-provided navAllowlist always wins (app knowledge beats derivation).
// Falling back to derivation only when the app has workspaces at all avoids
// flagging every nav as unreachable in a workspace-free app.
export function resolveNavAllowlist(
  explicitAllowlist: ReadonlySet<string> | undefined,
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
  allWorkspaceQns: ReadonlyMap<string, WorkspaceDefinition & { readonly featureName: string }>,
): ReadonlySet<string> | undefined {
  if (explicitAllowlist !== undefined) return explicitAllowlist;
  if (allWorkspaceQns.size === 0) return undefined;
  return deriveNavAllowlistFromWorkspaces(allNavQns, allWorkspaceQns);
}

// Single-default rule across the entire app. Mirrors how createApp validates
// roles up front — a second `default: true` is a configuration error, not a
// runtime fallback. Apps without any default fall back to "first workspace
// the user has access to" at render time (handled by shellWorkspaces).
export function validateDefaultWorkspaceUniqueness(
  allWorkspaceQns: ReadonlyMap<string, WorkspaceDefinition & { readonly featureName: string }>,
): void {
  const defaults: string[] = [];
  for (const [qn, ws] of allWorkspaceQns) {
    if (ws.default === true) defaults.push(qn);
  }
  if (defaults.length > 1) {
    throw new Error(
      `[Kumiko Workspaces] Multiple workspaces declare default: true — ` +
        `${defaults.join(", ")}. At most one workspace per app may be the default.`,
    );
  }
}
