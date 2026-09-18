// Nav validation + collectKnownRoles (role synthesis for ownership
// validation in index.ts — thematically adjacent to ownership.ts, kept
// here since this is a structural move, not a semantic reorg).

import { qualifyEntityName } from "../qualified-name";
import type { AccessRule, FeatureDefinition, NavDefinition, WorkspaceDefinition } from "../types";
import { isOpenToAllGranted } from "../types";

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
    if (navDef.createAction !== undefined) {
      validateTreeAction(feature.name, navId, "createAction", navDef.createAction, allScreenQns);
    }
    for (const [i, action] of (navDef.actions ?? []).entries()) {
      validateTreeAction(feature.name, navId, `actions[${i}]`, action, allScreenQns);
    }
  }
}

// A TreeAction (createAction or an actions[] entry) navigates via `screen`
// XOR dispatches via `target` — same polymorphism as the node's own
// `screen`/`target`. Without this check an action with neither is a
// Hover-Icon that does nothing; one with both is ambiguous about which
// click-mode wins.
function validateTreeAction(
  featureName: string,
  navId: string,
  actionPath: string,
  action: { readonly screen?: string; readonly target?: unknown },
  allScreenQns: ReadonlySet<string>,
): void {
  const { screen, target } = action;
  const hasScreen = screen !== undefined;
  const hasTarget = target !== undefined;
  if (hasScreen === hasTarget) {
    throw new Error(
      `[Feature ${featureName}] Nav entry "${navId}" ${actionPath} must set exactly one of ` +
        `"screen"/"target" (${hasScreen ? "both are set" : "neither is set"}).`,
    );
  }
  if (screen !== undefined && !allScreenQns.has(screen)) {
    throw new Error(
      `[Feature ${featureName}] Nav entry "${navId}" ${actionPath} references screen ` +
        `"${screen}" which is not registered. Expected a qualified name of the form ` +
        `"<feature>:screen:<id>" pointing at an r.screen() declaration.`,
    );
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

// undefined or granted openToAll means visible to everyone (no role-set to compare); malformed/denied openToAll returns `[]`, same as an explicit `roles: []`.
function navViewerRoles(access: AccessRule | undefined): readonly string[] | undefined {
  if (access === undefined) return undefined;
  if ("openToAll" in access) return isOpenToAllGranted(access) ? undefined : [];
  return access.roles;
}

// fw#2640: warn (never throw — this is a real UX bug, not a broken ref)
// when a nav leaf's role gate is disjoint from its parent section's — no
// user who can see the section could ever see this child, so the section
// renders with zero visible children for every user who reaches it.
// Only fires when BOTH sides declare an explicit, non-empty role list:
// an unset/openToAll side is visible to everyone, so it can't invert.
export function warnOnNavAccessInversion(
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
): void {
  for (const [qn, navDef] of allNavQns) {
    if (navDef.parent === undefined) continue;
    const parentDef = allNavQns.get(navDef.parent);
    if (parentDef === undefined) continue; // dangling parent ref — validateNavs already throws for this
    const parentRoles = navViewerRoles(parentDef.access);
    const leafRoles = navViewerRoles(navDef.access);
    if (parentRoles === undefined || leafRoles === undefined) continue;
    if (parentRoles.length === 0) continue; // parent already visible to nobody — a different problem
    if (leafRoles.some((role) => parentRoles.includes(role))) continue;
    // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
    console.warn(
      `[kumiko:boot] Nav entry "${qn}" requires roles [${leafRoles.join(", ")}] but its parent ` +
        `"${navDef.parent}" only allows [${parentRoles.join(", ")}] — no user who can see the ` +
        `parent section could ever see this entry. If this is intentional, ignore this warning; ` +
        `otherwise align the role sets.`,
    );
  }
}

// `NavDefinition.screen` is authored already-qualified ("<feature>:screen:
// <id>", see packages/types/src/nav.ts) — this only guards a short id
// slipping through, since a wrong qualification here would make every nav
// look orphaned (28 false positives on the real offlot-app schema instead
// of the intended 8, see fw#3019 measurement).
function qualifyNavScreenQn(featureName: string, screen: string): string {
  return screen.includes(":screen:") ? screen : `${featureName}:screen:${screen}`;
}

// fw#3019: warn (never throw — a screen deliberately left out of the app's
// sidebar is legitimate) when a declared nav's screen isn't reachable from
// any allowlisted nav entry. Checking "nav QN not in allowlist" directly
// warned 28x on the real offlot-app schema (58 navs, 30 allowed) — most of
// them app-shell leaves that intentionally re-target a screen another,
// allowlisted nav already reaches. Reachability warns only for a screen no
// allowlisted nav points at, which is the actual "unreachable via sidebar"
// bug (solon#113, offlot's VIN screen in pilot).
export function warnOnUnreachableNavScreens(
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
  allowedNavQns: ReadonlySet<string>,
  navAllowlistExempt: ReadonlySet<string> = new Set(),
): void {
  const reachableScreenQns = new Set<string>();
  for (const [qn, navDef] of allNavQns) {
    if (!allowedNavQns.has(qn) || navDef.screen === undefined) continue;
    reachableScreenQns.add(qualifyNavScreenQn(navDef.featureName, navDef.screen));
  }

  for (const [qn, navDef] of allNavQns) {
    if (allowedNavQns.has(qn) || navDef.screen === undefined || navAllowlistExempt.has(qn)) {
      continue;
    }
    const screenQn = qualifyNavScreenQn(navDef.featureName, navDef.screen);
    if (reachableScreenQns.has(screenQn)) continue;
    // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
    console.warn(
      `[kumiko:boot] Nav entry "${qn}" declared by feature "${navDef.featureName}" points at ` +
        `screen "${screenQn}", which no allowlisted nav entry reaches — it is unreachable via ` +
        `the sidebar. If this is intentional (e.g. reachable through a generated hub), add ` +
        `"${qn}" to navAllowlistExempt; otherwise add it to the allowlist.`,
    );
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
    for (const def of Object.values(f.streamHandlers)) {
      if (def.access && "roles" in def.access) {
        for (const r of def.access.roles) roles.add(r);
      }
    }
  }
  return roles;
}
