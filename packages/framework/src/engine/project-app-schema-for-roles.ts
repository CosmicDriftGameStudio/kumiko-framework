// Per-role projection of a fully-built AppSchema (fw#3314). GET /api/schema
// used to ship the same full schema — screens, navs, workspaces, content
// collections — to every authenticated user regardless of role, relying on
// client-side UI checks (isUiAccessGranted) alone to hide what a role
// shouldn't see. That leaves the raw schema JSON itself as a disclosure
// surface (role-gated screen ids/labels/handler QNs visible to anyone who
// can read the response). This module removes what a set of roles may not
// see from the schema BEFORE it's serialized — entities and translations
// stay complete (decided: option (a), a projected schema is still one
// screen/nav/workspace registry, not a per-entity capability list).
//
// Pure function: never mutates `schema`, returns a new object only where
// something actually changed — every helper below returns the ORIGINAL
// reference when nothing needed stripping, so a fully-open role (no access
// rules anywhere, or a role matching every rule) gets back the exact same
// object graph it was given, not a structurally-equal copy. That relies on
// object-spread's `...(cond && { key })` idiom already used throughout
// build-app-schema.ts: spreading `false` contributes nothing, so an
// omitted/undefined key never round-trips into an explicit `undefined`
// (buildAppSchema's own JSON-safety check would reject that).
//
// The dispatcher's own `hasAccess` (./access.ts) is UNCHANGED by this file —
// that's the default-deny handler-invocation gate, still the sole authority
// over whether a write/query actually executes. This module only decides
// what a client's schema fetch renders/lists, using the default-VISIBLE
// `isUiAccessGranted` predicate (see its doc comment in
// @cosmicdrift/kumiko-types/handlers) — an unset `access` here means every
// signed-in user may see the entry, the opposite stance from `hasAccess`.
//
// Reference-site coverage (every place boot-validator/screens.ts resolves a
// screen target is a site this file also projects):
//   - nav.screen / nav.parent (author-registered AND settings-hub-generated
//     navs — the latter use short ids relative to the synthetic "config"
//     feature, so target resolution applies the same isValidQn-guarded
//     qualify-or-verbatim rule uniformly, never assuming pre-qualification)
//   - nav/content-collection actions[] and createAction (TreeAction.screen —
//     always fully qualified per validateTreeAction, checked directly)
//   - rowActions/toolbarActions on entityList/projectionList (kind:"navigate"
//     resolves app-wide via a global short-id map, mirroring
//     resolveRowActionNavigateTarget; kind:"drawer" resolves same-feature
//     only, mirroring validateDrawerTargetAction)
//   - projectionDetail header actions + metrics[].navigate
//   - entityEdit/actionForm/secretMint redirect + actionForm cancelTarget
//     (resolveScreenTargetQn: same-feature short id or cross-feature QN)
//   - dashboard DashboardScreenPanel.screen (resolveScreenTargetQn)
//   - every EditSectionSpec kind's own `actions` (fields/extension/writeForm/
//     relatedList all carry one), plus relatedList's rowActions,
//     toolbarActions, rowClick.entity (via detailFor) and
//     emptyState.action — leak sites beyond the spec's literal enumeration,
//     closed here because they're real screen-navigate fields the same
//     boot-validator machinery resolves
//   - QualifiedContentCollection.nav.actions/createAction — a verbatim copy
//     distinct from the "real" nav entry's own actions, not kept in sync by
//     buildAppSchema
//   - WorkspaceSchema.definition.nav — the raw explicit nav-QN list,
//     verbatim in JSON, distinct from the computed/filtered navMembers
//   - listScreenId (projectionDetail/entityEdit/actionForm/secretMint/custom —
//     the breadcrumb "back to list" target). It's serialized, so a visible
//     screen would otherwise disclose a denied screen's short id. Resolved
//     the same way resolveNavParentScreen/renderer breadcrumbs do: a global
//     short-id lookup across every feature's screens (screen-helpers.ts),
//     the same convention as RowAction/ToolbarAction navigate-by-`.screen`,
//     not the same-feature-or-QN rule `resolveScreenTargetQn` uses.
//
// Deliberately OUT of scope: `TargetRef`-based `target` fields on nav/tree
// entries (an EditorPanel dispatch target, not a screen navigate — nothing
// to resolve against keptScreenQns).

import type {
  AppSchema,
  FeatureSchema,
  QualifiedContentCollection,
  WorkspaceSchema,
} from "../ui-types/app-schema.js";
import { resolveScreenTargetQn } from "./boot-validator/screens.js";
import { isValidQn, qualifyEntityName } from "./qualified-name.js";
import type { AccessRule } from "./types/handlers.js";
import { isUiAccessGranted } from "./types/handlers.js";
import type { NavDefinition } from "./types/nav.js";
import type {
  ActionFormRedirect,
  ActionFormScreenDefinition,
  DashboardPanelDefinition,
  EditLayout,
  EditRelatedListSection,
  EditSectionSpec,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  MetricNavigate,
  MetricSpec,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
  RelatedListToolbarAction,
  RowAction,
  ScreenDefinition,
  SecretMintScreenDefinition,
  ToolbarAction,
} from "./types/screen.js";
import type { TreeAction } from "./types/tree-node.js";
import type { WorkspaceDefinition } from "./types/workspace.js";

type ScreenLocation = { readonly featureName: string; readonly screen: ScreenDefinition };

type IndexedSchema = {
  readonly screensByShortId: ReadonlyMap<string, ScreenLocation>;
  readonly detailForScreens: ReadonlyMap<string, ScreenLocation>;
};

type NavContext = {
  readonly qn: string;
  readonly featureName: string;
  readonly nav: NavDefinition;
  readonly resolvedScreenQn: string | undefined;
  readonly resolvedParentQn: string | undefined;
};

export function projectAppSchemaForRoles(schema: AppSchema, roles: readonly string[]): AppSchema {
  const keptScreenQns = buildKeptScreenQns(schema, roles);
  const indices = buildScreenIndices(schema);
  const screenAccessByQn = buildScreenAccessMap(schema);
  const navContexts = buildNavContexts(schema);
  const droppedNavQns = buildDroppedNavQns(navContexts, screenAccessByQn, keptScreenQns, roles);
  const survivingNavQns = new Set(
    navContexts.filter((ctx) => !droppedNavQns.has(ctx.qn)).map((ctx) => ctx.qn),
  );

  let featuresChanged = false;
  const nextFeatures = schema.features.map((feature) => {
    const nextFeature = projectFeature(
      feature,
      roles,
      keptScreenQns,
      indices,
      droppedNavQns,
      survivingNavQns,
    );
    if (nextFeature !== feature) featuresChanged = true;
    return nextFeature;
  });

  const nextWorkspaces = projectWorkspaces(schema.workspaces, roles, survivingNavQns);

  if (!featuresChanged && nextWorkspaces === schema.workspaces) return schema;

  const { workspaces, ...restSchema } = schema;
  return {
    ...restSchema,
    features: featuresChanged ? nextFeatures : schema.features,
    ...(nextWorkspaces !== undefined && { workspaces: nextWorkspaces }),
  };
}

// --- indices over the ORIGINAL (unprojected) schema ---

function buildKeptScreenQns(schema: AppSchema, roles: readonly string[]): ReadonlySet<string> {
  const kept = new Set<string>();
  for (const feature of schema.features) {
    for (const screen of feature.screens) {
      if (isUiAccessGranted(screen.access, roles)) {
        kept.add(qualifyEntityName(feature.featureName, "screen", screen.id));
      }
    }
  }
  return kept;
}

function buildScreenIndices(schema: AppSchema): IndexedSchema {
  const screensByShortId = new Map<string, ScreenLocation>();
  const detailForScreens = new Map<string, ScreenLocation>();
  for (const feature of schema.features) {
    for (const screen of feature.screens) {
      if (!screensByShortId.has(screen.id)) {
        screensByShortId.set(screen.id, { featureName: feature.featureName, screen });
      }
      if (screen.detailFor !== undefined && !detailForScreens.has(screen.detailFor)) {
        detailForScreens.set(screen.detailFor, { featureName: feature.featureName, screen });
      }
    }
  }
  return { screensByShortId, detailForScreens };
}

function buildScreenAccessMap(schema: AppSchema): ReadonlyMap<string, AccessRule | undefined> {
  const map = new Map<string, AccessRule | undefined>();
  for (const feature of schema.features) {
    for (const screen of feature.screens) {
      map.set(qualifyEntityName(feature.featureName, "screen", screen.id), screen.access);
    }
  }
  return map;
}

// Settings-hub-generated navs share the short-id-relative-to-owning-feature
// convention with author-registered ones (they're merged verbatim into the
// synthetic "config" feature's own `navs`) — the isValidQn guard makes this
// resolution correct for both without needing to know which regime a given
// nav came from.
function resolveNavTargetQn(featureName: string, ref: string): string {
  return isValidQn(ref) ? ref : qualifyEntityName(featureName, "nav", ref);
}

function buildNavContexts(schema: AppSchema): readonly NavContext[] {
  const contexts: NavContext[] = [];
  for (const feature of schema.features) {
    for (const nav of feature.navs ?? []) {
      contexts.push({
        qn: qualifyEntityName(feature.featureName, "nav", nav.id),
        featureName: feature.featureName,
        nav,
        resolvedScreenQn:
          nav.screen !== undefined
            ? resolveScreenTargetQn(feature.featureName, nav.screen)
            : undefined,
        resolvedParentQn:
          nav.parent !== undefined
            ? resolveNavTargetQn(feature.featureName, nav.parent)
            : undefined,
      });
    }
  }
  return contexts;
}

// Initial per-nav drop decision (access + dead screen target) followed by a
// fixed-point propagation: a dropped parent drops its children, and a
// screenless grouping node that loses every child (and isn't a runtime
// `provider: true` node, whose children never come from other navs'
// `.parent`) drops itself too — an empty section is not worth keeping.
function buildDroppedNavQns(
  navContexts: readonly NavContext[],
  screenAccessByQn: ReadonlyMap<string, AccessRule | undefined>,
  keptScreenQns: ReadonlySet<string>,
  roles: readonly string[],
): ReadonlySet<string> {
  const childrenByParent = groupNavChildrenByParent(navContexts);
  const dropped = new Set<string>(
    navContexts
      .filter((ctx) => isNavDeniedOrDead(ctx, screenAccessByQn, keptScreenQns, roles))
      .map((ctx) => ctx.qn),
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const ctx of navContexts) {
      if (dropped.has(ctx.qn)) continue;
      if (isDroppedByPropagation(ctx, dropped, childrenByParent)) {
        dropped.add(ctx.qn);
        changed = true;
      }
    }
  }
  return dropped;
}

function groupNavChildrenByParent(
  navContexts: readonly NavContext[],
): ReadonlyMap<string, readonly NavContext[]> {
  const childrenByParent = new Map<string, NavContext[]>();
  for (const ctx of navContexts) {
    if (ctx.resolvedParentQn === undefined) continue;
    const siblings = childrenByParent.get(ctx.resolvedParentQn) ?? [];
    siblings.push(ctx);
    childrenByParent.set(ctx.resolvedParentQn, siblings);
  }
  return childrenByParent;
}

function isNavDeniedOrDead(
  ctx: NavContext,
  screenAccessByQn: ReadonlyMap<string, AccessRule | undefined>,
  keptScreenQns: ReadonlySet<string>,
  roles: readonly string[],
): boolean {
  // `nav.access` already carries `nav.access ?? collection.access` for a
  // content-collection's synthesized nav entry (feature-ui-extensions.ts
  // sets it at registration time) — no separate collection-access lookup
  // needed here.
  if (ctx.resolvedScreenQn === undefined) return !isUiAccessGranted(ctx.nav.access, roles);
  if (!keptScreenQns.has(ctx.resolvedScreenQn)) return true;
  const effectiveAccess = ctx.nav.access ?? screenAccessByQn.get(ctx.resolvedScreenQn);
  return !isUiAccessGranted(effectiveAccess, roles);
}

function isDroppedByPropagation(
  ctx: NavContext,
  dropped: ReadonlySet<string>,
  childrenByParent: ReadonlyMap<string, readonly NavContext[]>,
): boolean {
  if (ctx.resolvedParentQn !== undefined && dropped.has(ctx.resolvedParentQn)) return true;
  const isPureGroupingNode =
    ctx.nav.screen === undefined && ctx.nav.target === undefined && ctx.nav.provider !== true;
  if (!isPureGroupingNode) return false;
  const children = childrenByParent.get(ctx.qn) ?? [];
  return children.length > 0 && children.every((child) => dropped.has(child.qn));
}

// --- screen-target resolution helpers (mirror boot-validator/screens.ts) ---

function isScreenTargetKept(
  featureName: string,
  target: string,
  keptScreenQns: ReadonlySet<string>,
): boolean {
  return keptScreenQns.has(resolveScreenTargetQn(featureName, target));
}

function isRedirectTargetKept(
  featureName: string,
  target: string | ActionFormRedirect,
  keptScreenQns: ReadonlySet<string>,
): boolean {
  const screenRef = typeof target === "string" ? target : target.screen;
  return isScreenTargetKept(featureName, screenRef, keptScreenQns);
}

function isDrawerTargetKept(
  feature: FeatureSchema,
  shortId: string,
  keptScreenQns: ReadonlySet<string>,
): boolean {
  return keptScreenQns.has(qualifyEntityName(feature.featureName, "screen", shortId));
}

function isListScreenIdKept(
  listScreenId: string,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): boolean {
  const target = indices.screensByShortId.get(listScreenId);
  if (target === undefined) return false;
  return keptScreenQns.has(qualifyEntityName(target.featureName, "screen", target.screen.id));
}

function resolveNavigateTarget(
  action: { readonly screen?: string; readonly entity?: string },
  indices: IndexedSchema,
): ScreenLocation | undefined {
  if (action.entity !== undefined) return indices.detailForScreens.get(action.entity);
  if (action.screen !== undefined) return indices.screensByShortId.get(action.screen);
  return undefined;
}

function isNavigateTargetKept(
  action: { readonly screen?: string; readonly entity?: string },
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): boolean {
  const target = resolveNavigateTarget(action, indices);
  if (target === undefined) return false;
  return keptScreenQns.has(qualifyEntityName(target.featureName, "screen", target.screen.id));
}

function keepMetricNavigate(
  navigate: MetricNavigate,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): boolean {
  if (navigate.screen === undefined && navigate.entity === undefined) return true; // same-record tab jump
  return isNavigateTargetKept(navigate, indices, keptScreenQns);
}

function keepTreeAction(action: TreeAction, keptScreenQns: ReadonlySet<string>): boolean {
  if (action.screen === undefined) return true; // target-based dispatch, not a screen navigate
  return keptScreenQns.has(action.screen);
}

// --- RowAction / ToolbarAction / RelatedListToolbarAction array projectors ---
// Each returns the ORIGINAL array reference when nothing was filtered, and
// `undefined` (never an empty array) when everything was — same JSON-safety
// convention as buildAppSchema.

function keepRowAction(
  action: RowAction,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): boolean {
  if (action.kind === "drawer") return isDrawerTargetKept(feature, action.screen, keptScreenQns);
  if (action.kind === "navigate") return isNavigateTargetKept(action, indices, keptScreenQns);
  return true; // writeHandler — no screen target
}

function projectRowActionArray(
  actions: readonly RowAction[] | undefined,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): readonly RowAction[] | undefined {
  if (actions === undefined) return undefined;
  const kept = actions.filter((a) => keepRowAction(a, feature, indices, keptScreenQns));
  if (kept.length === actions.length) return actions;
  return kept.length > 0 ? kept : undefined;
}

function keepToolbarAction(
  action: ToolbarAction,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): boolean {
  if (action.kind === "navigate") return isNavigateTargetKept(action, indices, keptScreenQns);
  if (action.kind === "drawer") return isDrawerTargetKept(feature, action.screen, keptScreenQns);
  return true;
}

function projectToolbarActionArray(
  actions: readonly ToolbarAction[] | undefined,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): readonly ToolbarAction[] | undefined {
  if (actions === undefined) return undefined;
  const kept = actions.filter((a) => keepToolbarAction(a, feature, indices, keptScreenQns));
  if (kept.length === actions.length) return actions;
  return kept.length > 0 ? kept : undefined;
}

function keepRelatedListToolbarAction(
  action: RelatedListToolbarAction,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): boolean {
  if (action.kind === "navigate") return isNavigateTargetKept(action, indices, keptScreenQns);
  if (action.kind === "drawer") return isDrawerTargetKept(feature, action.screen, keptScreenQns);
  return true;
}

function projectRelatedListToolbarActionArray(
  actions: readonly RelatedListToolbarAction[] | undefined,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): readonly RelatedListToolbarAction[] | undefined {
  if (actions === undefined) return undefined;
  const kept = actions.filter((a) =>
    keepRelatedListToolbarAction(a, feature, indices, keptScreenQns),
  );
  if (kept.length === actions.length) return actions;
  return kept.length > 0 ? kept : undefined;
}

function projectTreeActionArray(
  actions: readonly TreeAction[] | undefined,
  keptScreenQns: ReadonlySet<string>,
): readonly TreeAction[] | undefined {
  if (actions === undefined) return undefined;
  const kept = actions.filter((a) => keepTreeAction(a, keptScreenQns));
  if (kept.length === actions.length) return actions;
  return kept.length > 0 ? kept : undefined;
}

function projectTreeAction(
  action: TreeAction | undefined,
  keptScreenQns: ReadonlySet<string>,
): TreeAction | undefined {
  if (action === undefined) return undefined;
  return keepTreeAction(action, keptScreenQns) ? action : undefined;
}

function isRowClickEntityKept(
  entity: string,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): boolean {
  const target = indices.detailForScreens.get(entity);
  if (target === undefined) return false;
  return keptScreenQns.has(qualifyEntityName(target.featureName, "screen", target.screen.id));
}

// --- EditLayout / EditSectionSpec projection ---

function projectEmptyState(
  emptyState: EditRelatedListSection["emptyState"],
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): EditRelatedListSection["emptyState"] {
  if (emptyState === undefined) return undefined;
  if (emptyState.action === undefined) return emptyState;
  if (keepRowAction(emptyState.action, feature, indices, keptScreenQns)) return emptyState;
  const { action, ...rest } = emptyState;
  return rest;
}

function projectRelatedListSection(
  section: EditRelatedListSection,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): EditRelatedListSection {
  const { actions, rowActions, toolbarActions, rowClick, emptyState, ...rest } = section;
  const nextActions = projectRowActionArray(actions, feature, indices, keptScreenQns);
  const nextRowActions = projectRowActionArray(rowActions, feature, indices, keptScreenQns);
  const nextToolbarActions = projectRelatedListToolbarActionArray(
    toolbarActions,
    feature,
    indices,
    keptScreenQns,
  );
  const nextRowClick =
    rowClick === undefined || isRowClickEntityKept(rowClick.entity, indices, keptScreenQns)
      ? rowClick
      : undefined;
  const nextEmptyState = projectEmptyState(emptyState, feature, indices, keptScreenQns);
  if (
    nextActions === actions &&
    nextRowActions === rowActions &&
    nextToolbarActions === toolbarActions &&
    nextRowClick === rowClick &&
    nextEmptyState === emptyState
  ) {
    return section;
  }
  return {
    ...rest,
    ...(nextActions !== undefined && { actions: nextActions }),
    ...(nextRowActions !== undefined && { rowActions: nextRowActions }),
    ...(nextToolbarActions !== undefined && { toolbarActions: nextToolbarActions }),
    ...(nextRowClick !== undefined && { rowClick: nextRowClick }),
    ...(nextEmptyState !== undefined && { emptyState: nextEmptyState }),
  };
}

function projectEditSection(
  section: EditSectionSpec,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): EditSectionSpec {
  switch (section.kind) {
    case "relatedList":
      return projectRelatedListSection(section, feature, indices, keptScreenQns);
    case "extension": {
      const { actions, ...rest } = section;
      const kept = projectRowActionArray(actions, feature, indices, keptScreenQns);
      return kept === actions ? section : { ...rest, ...(kept !== undefined && { actions: kept }) };
    }
    case "writeForm": {
      const { actions, ...rest } = section;
      const kept = projectRowActionArray(actions, feature, indices, keptScreenQns);
      return kept === actions ? section : { ...rest, ...(kept !== undefined && { actions: kept }) };
    }
    default: {
      // kind undefined or "fields"
      const { actions, ...rest } = section;
      const kept = projectRowActionArray(actions, feature, indices, keptScreenQns);
      return kept === actions ? section : { ...rest, ...(kept !== undefined && { actions: kept }) };
    }
  }
}

function projectEditLayout(
  layout: EditLayout,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): EditLayout {
  const nextSections = layout.sections.map((s) =>
    projectEditSection(s, feature, indices, keptScreenQns),
  );
  const changed = nextSections.some((s, i) => s !== layout.sections[i]);
  if (!changed) return layout;
  return { ...layout, sections: nextSections };
}

function projectMetrics(
  metrics: readonly MetricSpec[] | undefined,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): readonly MetricSpec[] | undefined {
  if (metrics === undefined) return undefined;
  let changed = false;
  const next = metrics.map((m) => {
    if (typeof m === "string" || m.navigate === undefined) return m;
    if (keepMetricNavigate(m.navigate, indices, keptScreenQns)) return m;
    changed = true;
    const { navigate, ...rest } = m;
    return rest;
  });
  return changed ? next : metrics;
}

function projectDashboardPanels(
  panels: readonly DashboardPanelDefinition[],
  feature: FeatureSchema,
  keptScreenQns: ReadonlySet<string>,
): readonly DashboardPanelDefinition[] {
  const kept = panels.filter(
    (p) => p.kind !== "screen" || isScreenTargetKept(feature.featureName, p.screen, keptScreenQns),
  );
  return kept.length === panels.length ? panels : kept;
}

// --- per-screen-type projection ---

function projectListScreenId(
  listScreenId: string | undefined,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): string | undefined {
  if (listScreenId === undefined) return undefined;
  return isListScreenIdKept(listScreenId, indices, keptScreenQns) ? listScreenId : undefined;
}

function projectRedirect<Redirect extends string | ActionFormRedirect>(
  featureName: string,
  redirect: Redirect | undefined,
  keptScreenQns: ReadonlySet<string>,
): Redirect | undefined {
  if (redirect === undefined) return undefined;
  return isRedirectTargetKept(featureName, redirect, keptScreenQns) ? redirect : undefined;
}

function projectCancelTarget(
  featureName: string,
  cancelTarget: string | false | undefined,
  keptScreenQns: ReadonlySet<string>,
): string | false | undefined {
  if (cancelTarget === undefined || cancelTarget === false) return cancelTarget;
  return isScreenTargetKept(featureName, cancelTarget, keptScreenQns) ? cancelTarget : undefined;
}

function projectListScreen(
  screen: EntityListScreenDefinition | ProjectionListScreenDefinition,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): ScreenDefinition {
  const { rowActions, toolbarActions, ...rest } = screen;
  const nextRowActions = projectRowActionArray(rowActions, feature, indices, keptScreenQns);
  const nextToolbarActions = projectToolbarActionArray(
    toolbarActions,
    feature,
    indices,
    keptScreenQns,
  );
  if (nextRowActions === rowActions && nextToolbarActions === toolbarActions) return screen;
  return {
    ...rest,
    ...(nextRowActions !== undefined && { rowActions: nextRowActions }),
    ...(nextToolbarActions !== undefined && { toolbarActions: nextToolbarActions }),
  };
}

function projectProjectionDetailScreen(
  screen: ProjectionDetailScreenDefinition,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): ScreenDefinition {
  const { metrics, actions, layout, listScreenId, ...rest } = screen;
  const nextMetrics = projectMetrics(metrics, indices, keptScreenQns);
  const nextActions = projectRowActionArray(actions, feature, indices, keptScreenQns);
  const nextLayout = projectEditLayout(layout, feature, indices, keptScreenQns);
  const nextListScreenId = projectListScreenId(listScreenId, indices, keptScreenQns);
  const unchanged =
    nextMetrics === metrics &&
    nextActions === actions &&
    nextLayout === layout &&
    nextListScreenId === listScreenId;
  if (unchanged) return screen;
  return {
    ...rest,
    layout: nextLayout,
    ...(nextMetrics !== undefined && { metrics: nextMetrics }),
    ...(nextActions !== undefined && { actions: nextActions }),
    ...(nextListScreenId !== undefined && { listScreenId: nextListScreenId }),
  };
}

function projectEntityEditScreen(
  screen: EntityEditScreenDefinition,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): ScreenDefinition {
  const { redirect, actions, layout, listScreenId, ...rest } = screen;
  const nextRedirect = projectRedirect(feature.featureName, redirect, keptScreenQns);
  const nextActions = projectRowActionArray(actions, feature, indices, keptScreenQns);
  const nextLayout = projectEditLayout(layout, feature, indices, keptScreenQns);
  const nextListScreenId = projectListScreenId(listScreenId, indices, keptScreenQns);
  const unchanged =
    nextRedirect === redirect &&
    nextActions === actions &&
    nextLayout === layout &&
    nextListScreenId === listScreenId;
  if (unchanged) return screen;
  return {
    ...rest,
    layout: nextLayout,
    ...(nextRedirect !== undefined && { redirect: nextRedirect }),
    ...(nextActions !== undefined && { actions: nextActions }),
    ...(nextListScreenId !== undefined && { listScreenId: nextListScreenId }),
  };
}

function projectActionFormScreen(
  screen: ActionFormScreenDefinition,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): ScreenDefinition {
  const { redirect, cancelTarget, layout, listScreenId, ...rest } = screen;
  const nextRedirect = projectRedirect(feature.featureName, redirect, keptScreenQns);
  const nextCancelTarget = projectCancelTarget(feature.featureName, cancelTarget, keptScreenQns);
  const nextLayout = projectEditLayout(layout, feature, indices, keptScreenQns);
  const nextListScreenId = projectListScreenId(listScreenId, indices, keptScreenQns);
  const unchanged =
    nextRedirect === redirect &&
    nextCancelTarget === cancelTarget &&
    nextLayout === layout &&
    nextListScreenId === listScreenId;
  if (unchanged) return screen;
  return {
    ...rest,
    layout: nextLayout,
    ...(nextRedirect !== undefined && { redirect: nextRedirect }),
    ...(nextCancelTarget !== undefined && { cancelTarget: nextCancelTarget }),
    ...(nextListScreenId !== undefined && { listScreenId: nextListScreenId }),
  };
}

function projectSecretMintScreen(
  screen: SecretMintScreenDefinition,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): ScreenDefinition {
  const { redirect, cancelTarget, layout, listScreenId, ...rest } = screen;
  const nextRedirect = projectRedirect(feature.featureName, redirect, keptScreenQns);
  const nextCancelTarget = projectCancelTarget(feature.featureName, cancelTarget, keptScreenQns);
  const nextLayout = projectEditLayout(layout, feature, indices, keptScreenQns);
  const nextListScreenId = projectListScreenId(listScreenId, indices, keptScreenQns);
  const unchanged =
    nextRedirect === redirect &&
    nextCancelTarget === cancelTarget &&
    nextLayout === layout &&
    nextListScreenId === listScreenId;
  if (unchanged) return screen;
  return {
    ...rest,
    layout: nextLayout,
    ...(nextRedirect !== undefined && { redirect: nextRedirect }),
    ...(nextCancelTarget !== undefined && { cancelTarget: nextCancelTarget }),
    ...(nextListScreenId !== undefined && { listScreenId: nextListScreenId }),
  };
}

function projectScreen(
  screen: ScreenDefinition,
  feature: FeatureSchema,
  indices: IndexedSchema,
  keptScreenQns: ReadonlySet<string>,
): ScreenDefinition {
  switch (screen.type) {
    case "entityList":
    case "projectionList":
      return projectListScreen(screen, feature, indices, keptScreenQns);
    case "projectionDetail":
      return projectProjectionDetailScreen(screen, feature, indices, keptScreenQns);
    case "dashboard": {
      const nextPanels = projectDashboardPanels(screen.panels, feature, keptScreenQns);
      return nextPanels === screen.panels ? screen : { ...screen, panels: nextPanels };
    }
    case "entityEdit":
      return projectEntityEditScreen(screen, feature, indices, keptScreenQns);
    case "actionForm":
      return projectActionFormScreen(screen, feature, indices, keptScreenQns);
    case "secretMint":
      return projectSecretMintScreen(screen, feature, indices, keptScreenQns);
    case "custom": {
      const { listScreenId, ...rest } = screen;
      const nextListScreenId = projectListScreenId(listScreenId, indices, keptScreenQns);
      if (nextListScreenId === listScreenId) return screen;
      return { ...rest, ...(nextListScreenId !== undefined && { listScreenId: nextListScreenId }) };
    }
    // configEdit / secretsEdit carry no screen-navigate fields (see
    // screen.ts's own definitions) — nothing to project.
    default:
      return screen;
  }
}

// --- nav / content-collection / workspace projection ---

function projectNav(nav: NavDefinition, keptScreenQns: ReadonlySet<string>): NavDefinition {
  const { actions, createAction, ...rest } = nav;
  const nextActions = projectTreeActionArray(actions, keptScreenQns);
  const nextCreateAction = projectTreeAction(createAction, keptScreenQns);
  if (nextActions === actions && nextCreateAction === createAction) return nav;
  return {
    ...rest,
    ...(nextActions !== undefined && { actions: nextActions }),
    ...(nextCreateAction !== undefined && { createAction: nextCreateAction }),
  };
}

function projectContentCollectionNav(
  collection: QualifiedContentCollection,
  keptScreenQns: ReadonlySet<string>,
): QualifiedContentCollection {
  const { actions, createAction, ...restNav } = collection.nav;
  const nextActions = projectTreeActionArray(actions, keptScreenQns);
  const nextCreateAction = projectTreeAction(createAction, keptScreenQns);
  if (nextActions === actions && nextCreateAction === createAction) return collection;
  return {
    ...collection,
    nav: {
      ...restNav,
      ...(nextActions !== undefined && { actions: nextActions }),
      ...(nextCreateAction !== undefined && { createAction: nextCreateAction }),
    },
  };
}

function projectContentCollections(
  collections: readonly QualifiedContentCollection[] | undefined,
  roles: readonly string[],
  survivingNavQns: ReadonlySet<string>,
  keptScreenQns: ReadonlySet<string>,
): readonly QualifiedContentCollection[] | undefined {
  if (collections === undefined) return undefined;
  let changed = false;
  const kept: QualifiedContentCollection[] = [];
  for (const collection of collections) {
    if (!isUiAccessGranted(collection.access, roles) || !survivingNavQns.has(collection.navQn)) {
      changed = true;
      continue;
    }
    const nextCollection = projectContentCollectionNav(collection, keptScreenQns);
    if (nextCollection !== collection) changed = true;
    kept.push(nextCollection);
  }
  if (!changed) return collections;
  return kept.length > 0 ? kept : undefined;
}

function projectWorkspaceMembership(
  ws: WorkspaceSchema,
  survivingNavQns: ReadonlySet<string>,
): WorkspaceSchema | undefined {
  const nextNavMembers = ws.navMembers.filter((qn) => survivingNavQns.has(qn));
  // Only a workspace the projection emptied is dropped; one declared without
  // members stays exactly as buildAppSchema produced it.
  if (nextNavMembers.length === 0 && ws.navMembers.length > 0) return undefined;
  const definitionNav: WorkspaceDefinition["nav"] = ws.definition.nav;
  const nextDefinitionNav = definitionNav?.filter((qn) => survivingNavQns.has(qn));
  const navMembersUnchanged = nextNavMembers.length === ws.navMembers.length;
  const definitionNavUnchanged =
    definitionNav === undefined || nextDefinitionNav?.length === definitionNav.length;
  if (navMembersUnchanged && definitionNavUnchanged) return ws;
  const { nav, ...restDefinition } = ws.definition;
  return {
    ...ws,
    navMembers: nextNavMembers,
    definition: {
      ...restDefinition,
      ...(nextDefinitionNav !== undefined &&
        nextDefinitionNav.length > 0 && { nav: nextDefinitionNav }),
    },
  };
}

function projectWorkspaces(
  workspaces: readonly WorkspaceSchema[] | undefined,
  roles: readonly string[],
  survivingNavQns: ReadonlySet<string>,
): readonly WorkspaceSchema[] | undefined {
  if (workspaces === undefined) return undefined;
  let changed = false;
  const kept: WorkspaceSchema[] = [];
  for (const ws of workspaces) {
    if (!isUiAccessGranted(ws.definition.access, roles)) {
      changed = true;
      continue;
    }
    const nextWorkspace = projectWorkspaceMembership(ws, survivingNavQns);
    if (nextWorkspace === undefined) {
      changed = true;
      continue;
    }
    if (nextWorkspace !== ws) changed = true;
    kept.push(nextWorkspace);
  }
  if (!changed) return workspaces;
  // An empty result behaves identically to `undefined` on the client
  // (WorkspaceShell's `hasWorkspaceMode` check requires `.length > 0`
  // either way) — omit the key rather than ship `[]`, matching
  // buildAppSchema's own JSON-safety convention.
  return kept.length > 0 ? kept : undefined;
}

function projectFeature(
  feature: FeatureSchema,
  roles: readonly string[],
  keptScreenQns: ReadonlySet<string>,
  indices: IndexedSchema,
  droppedNavQns: ReadonlySet<string>,
  survivingNavQns: ReadonlySet<string>,
): FeatureSchema {
  const { screens, navs, contentCollections, workspaces, ...rest } = feature;

  let screensChanged = false;
  const nextScreens = screens
    .filter((s) => keptScreenQns.has(qualifyEntityName(feature.featureName, "screen", s.id)))
    .map((s) => {
      const projected = projectScreen(s, feature, indices, keptScreenQns);
      if (projected !== s) screensChanged = true;
      return projected;
    });
  if (nextScreens.length !== screens.length) screensChanged = true;

  const originalNavs = navs ?? [];
  const filteredNavs = originalNavs.filter(
    (nav) => !droppedNavQns.has(qualifyEntityName(feature.featureName, "nav", nav.id)),
  );
  let anyNavProjected = false;
  const projectedNavs = filteredNavs.map((nav) => {
    const next = projectNav(nav, keptScreenQns);
    if (next !== nav) anyNavProjected = true;
    return next;
  });
  const navsChanged = filteredNavs.length !== originalNavs.length || anyNavProjected;
  const finalNavs = projectedNavs.length > 0 ? projectedNavs : undefined;

  const nextContentCollections = projectContentCollections(
    contentCollections,
    roles,
    survivingNavQns,
    keptScreenQns,
  );
  const nextFeatureWorkspaces = projectWorkspaces(workspaces, roles, survivingNavQns);

  const contentCollectionsChanged = nextContentCollections !== contentCollections;
  const featureWorkspacesChanged = nextFeatureWorkspaces !== workspaces;

  if (!screensChanged && !navsChanged && !contentCollectionsChanged && !featureWorkspacesChanged) {
    return feature;
  }

  return {
    ...rest,
    screens: nextScreens,
    ...(finalNavs !== undefined && { navs: finalNavs }),
    ...(nextContentCollections !== undefined && { contentCollections: nextContentCollections }),
    ...(nextFeatureWorkspaces !== undefined && { workspaces: nextFeatureWorkspaces }),
  };
}
