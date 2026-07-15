// Nav validation + collectKnownRoles (role synthesis for ownership
// validation in index.ts — thematically adjacent to ownership.ts, kept
// here since this is a structural move, not a semantic reorg).

import { qualifyEntityName } from "../qualified-name";
import type { FeatureDefinition, NavDefinition, WorkspaceDefinition } from "../types";

export function collectWriteHandlerQns(features: readonly FeatureDefinition[]): Set<string> {
  const set = new Set<string>();
  for (const f of features) {
    for (const handlerName of Object.keys(f.writeHandlers)) {
      set.add(qualifyEntityName(f.name, "write", handlerName));
    }
  }
  return set;
}

export function collectNavQns(
  features: readonly FeatureDefinition[],
): Map<string, NavDefinition & { readonly featureName: string }> {
  const map = new Map<string, NavDefinition & { readonly featureName: string }>();
  for (const f of features) {
    for (const [navId, navDef] of Object.entries(f.navs)) {
      const qualified = qualifyEntityName(f.name, "nav", navId);
      map.set(qualified, { ...navDef, featureName: f.name });
    }
  }
  return map;
}

// Per-feature ref validation: screen + parent refs point at real QNs. Cycle
// detection runs once globally afterwards (it's cheaper to do a single DFS
// over the merged graph than restart it per feature).
export function validateNavs(
  feature: FeatureDefinition,
  allScreenQns: ReadonlySet<string>,
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
  allWorkspaceQns: ReadonlyMap<string, WorkspaceDefinition & { readonly featureName: string }>,
): void {
  for (const [navId, navDef] of Object.entries(feature.navs)) {
    if (navDef.screen !== undefined && !allScreenQns.has(navDef.screen)) {
      throw new Error(
        `[Feature ${feature.name}] Nav entry "${navId}" references screen "${navDef.screen}" ` +
          `which is not registered. Expected a qualified name of the form ` +
          `"<feature>:screen:<id>" pointing at an r.screen() declaration.`,
      );
    }
    if (navDef.parent !== undefined && !allNavQns.has(navDef.parent)) {
      throw new Error(
        `[Feature ${feature.name}] Nav entry "${navId}" references parent "${navDef.parent}" ` +
          `which is not a registered nav entry. Expected a qualified name of the form ` +
          `"<feature>:nav:<id>".`,
      );
    }
    if (navDef.workspaces !== undefined) {
      for (const wsQn of navDef.workspaces) {
        if (!allWorkspaceQns.has(wsQn)) {
          throw new Error(
            `[Feature ${feature.name}] Nav entry "${navId}" self-assigns to workspace "${wsQn}" ` +
              `which is not registered. Expected a qualified name of the form ` +
              `"<feature>:workspace:<id>" pointing at an r.workspace() declaration.`,
          );
        }
      }
    }
  }
}

// Walks parent-refs across ALL nav entries (cross-feature). A cycle here
// would crash client-side tree assembly — easier to fail loud at boot than
// to debug a React "Maximum update depth exceeded" stack trace.
export function validateNavCycles(
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
): void {
  const visited = new Set<string>();
  const stack = new Set<string>();

  function visit(qualified: string, path: string[]): void {
    if (stack.has(qualified)) {
      throw new Error(
        `[Kumiko Nav] Nav entry parent cycle detected: ${[...path, qualified].join(" → ")}`,
      );
    }
    // skip: already visited — cycle-detection only needs to traverse each
    // node once, and the `stack` check above catches any actual cycles
    // reached via a different path.
    if (visited.has(qualified)) return;
    visited.add(qualified);
    stack.add(qualified);
    const navDef = allNavQns.get(qualified);
    if (navDef?.parent) {
      visit(navDef.parent, [...path, qualified]);
    }
    stack.delete(qualified);
  }

  for (const qualified of allNavQns.keys()) {
    visit(qualified, []);
  }
}

// Roles we recognise at boot time. The framework has no explicit
// role-registry (r.defineRoles is a type helper only), so we synthesise
// one from every handler-access rule plus the "all"/"system" built-ins.
export function collectKnownRoles(features: readonly FeatureDefinition[]): Set<string> {
  const roles = new Set<string>(["all", "system"]);
  for (const f of features) {
    for (const def of Object.values(f.writeHandlers)) {
      if (def.access && "roles" in def.access) {
        for (const r of def.access.roles) roles.add(r);
      }
    }
    for (const def of Object.values(f.queryHandlers)) {
      if (def.access && "roles" in def.access) {
        for (const r of def.access.roles) roles.add(r);
      }
    }
  }
  return roles;
}
