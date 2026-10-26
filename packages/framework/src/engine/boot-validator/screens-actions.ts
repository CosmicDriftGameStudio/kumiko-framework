import { resolveActionIcon } from "@cosmicdrift/kumiko-types/action-icon";
import type { IconKey } from "@cosmicdrift/kumiko-types/nav-icon";
import { NAV_ICON_KEYS } from "@cosmicdrift/kumiko-types/nav-icon";
import {
  fallbackTargets,
  SCREEN_FALLBACK_REASONS,
  type ScreenFallback,
  type ScreenFallbackByReason,
} from "@cosmicdrift/kumiko-types/screen";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { isKebabSegment, isValidQn, qualifyEntityName } from "../qualified-name.ts";
import { isFieldsEditSection, normalizeEditField, sectionFieldSpecs } from "../screen-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";
import type {
  ActionFormRedirect,
  ActionFormScreenDefinition,
  ActionFormSuccessLink,
  EditLayout,
  FieldCondition,
  ProjectionDetailScreenDefinition,
  RelatedListToolbarAction,
  RowAction,
  RowActionNavigateBase,
  RowFieldExtractor,
  ScreenDefinition,
  SecretMintScreenDefinition,
  ToolbarAction,
} from "../types/screen.ts";

export function isRowClickAction(action: RowAction): boolean {
  return (action.kind === "navigate" || action.kind === "drawer") && action.rowClick === true;
}

// entityList and projectionList both allow a rowAction to double as the
// row-body click target (rowClick: true) — at most one per
// screen, or the renderer can't tell which one should fire.
export function validateAtMostOneRowClick(
  featureName: string,
  screenId: string,
  screenType: "entityList" | "projectionList",
  rowActions: readonly RowAction[],
): void {
  const rowClickActions = rowActions.filter(isRowClickAction);
  if (rowClickActions.length > 1) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has ${rowClickActions.length} ` +
        "rowActions marked rowClick:true — at most one may fire on a row-body click. Mark at most one rowAction with rowClick: true.",
    );
  }
}

export function rowFieldExtractorKeys(params: RowFieldExtractor): readonly string[] {
  return "pick" in params ? params.pick : Object.keys(params.map);
}

// Mirrors the renderer's navigate: an explicit entityId, or a same-entity
// entityEdit target (row["id"] auto-fill), opens UPDATE mode, which ignores params.
export function readsNavigateParamsAsFormPrefill(
  target: ScreenDefinition,
  explicitEntityId: string | undefined,
  sourceScreenEntity: string | undefined,
): boolean {
  if (target.type === "actionForm" || target.type === "secretMint") return true;
  if (target.type !== "entityEdit") return false;
  if (explicitEntityId !== undefined) return false;
  return sourceScreenEntity === undefined || target.entity !== sourceScreenEntity;
}

export type NavigateSourceScreenType =
  | "dashboard"
  | "entityList"
  | "projectionList"
  | "projectionDetail"
  | "entityEdit"
  | "actionForm"
  | "secretMint"
  | "entityList expandableRow";

// Navigate rowAction → target-screen params validity. Shared by
// entityList and projectionList — projectionList has no
// `screen.entity`, so there's no same-entity row["id"] auto-fill case: any
// entityEdit target without an explicit entityId reaches create there.
//
// Dashboard targets also read URL search params — but only for the single
// `filter.id` a dashboard declares (useFilterParams in dashboard-body.tsx
// seeds its value from `nav.searchParams[filter.id]`). A dashboard with no
// `filter` has nowhere for the value to land, and a params extractor whose
// keys don't include the filter's id would silently miss it — both are boot
// errors instead of a silently-empty dashboard.
export function validateRowActionNavigateParams(
  featureName: string,
  screenId: string,
  screenType: NavigateSourceScreenType,
  screenEntity: string | undefined,
  action: RowAction,
  target: { readonly featureName: string; readonly screen: ScreenDefinition } | undefined,
  actionLabel: "rowAction" | "emptyState action" = "rowAction",
): void {
  // skip: not a navigate-with-params action — nothing to validate here.
  if (action.kind !== "navigate" || action.params === undefined) return;
  // skip: unresolvable/custom target already reported (or exempt) elsewhere.
  if (target === undefined || target.screen.type === "custom") return;
  // skip: entityList/projectionList targets also read URL search params (Tier
  // 2.7c filter-prefill, see use-list-url-state.ts: `<screenId>.q/.sort/
  // .dir/.page/.f.<field>`), not just actionForm/entityEdit-create.
  if (target.screen.type === "entityList" || target.screen.type === "projectionList") return;

  if (target.screen.type === "dashboard") {
    const targetDescriptor =
      action.screen !== undefined ? `"${action.screen}"` : `entity "${action.entity}"`;
    const { filter, record, timeRange } = target.screen;
    const readIds = [filter?.id, record?.param, timeRange?.id].filter(
      (id): id is string => id !== undefined,
    );
    if (readIds.length === 0) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" sets ` +
          `params on navigate-target ${targetDescriptor} (dashboard) — target dashboard declares no ` +
          `filter, time range or record binding — params would be a no-op. Remove the params extractor, or add a \`filter\` (or a \`record\` binding) to the ` +
          `target dashboard so it has somewhere to read the value from.`,
      );
    }
    const extractedKeys = rowFieldExtractorKeys(action.params);
    if (!readIds.some((id) => extractedKeys.includes(id))) {
      const readDescriptor =
        filter !== undefined && readIds.length === 1
          ? `filter id is "${filter.id}"`
          : `URL params are [${readIds.join(", ")}]`;
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" sets ` +
          `params [${extractedKeys.join(", ")}] on navigate-target ${targetDescriptor} (dashboard) whose ` +
          `${readDescriptor} — none of the extracted keys match, so the value would stay ` +
          `unset. Fix the params extractor to produce one of these keys, or remove it.`,
      );
    }
    // skip: a read id is present and the extractor's keys cover it — valid dashboard deep-link.
    return;
  }

  if (!readsNavigateParamsAsFormPrefill(target.screen, action.entityId, screenEntity)) {
    const isEntityEditUpdate = target.screen.type === "entityEdit";
    const reason = isEntityEditUpdate
      ? `resolves to UPDATE mode (${
          action.entityId !== undefined
            ? `explicit entityId "${action.entityId}"`
            : `same entity "${screenEntity}" auto-fills row["id"]`
        })`
      : `screen type "${target.screen.type}"`;
    const targetDescriptor =
      action.screen !== undefined ? `"${action.screen}"` : `entity "${action.entity}"`;
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
        `sets params on navigate-target ${targetDescriptor} which ${reason} — only actionForm, ` +
        `secretMint and entityEdit-create targets read URL search params as initial values. Remove ` +
        `the params extractor or retarget to an actionForm / secretMint / cross-entity ` +
        `entityEdit-create screen.`,
    );
  }

  const formTarget = target.screen;
  if (
    (formTarget.type === "actionForm" || formTarget.type === "secretMint") &&
    formTarget.submitPrefilled === true
  ) {
    validateDrawerPrefillKeys(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}"`,
      "navigate-target",
      action.screen ?? `entity "${action.entity}"`,
      formTarget,
      action.params,
    );
  }
}

// every action rendered in a Card title row (screen-level
// `actions`, section-level `actions`, `emptyState.action`) must draw an
// icon — declared or id-derived (resolveActionIcon, same resolver the
// renderer uses). Uncovered here: entityList/projectionList rowActions —
// those render inside a DataTable row, not a Card title row, so they keep
// today's "icon optional" behavior.
//
// Registration check (not just "resolved is not undefined"): action.icon is
// typed IconKey, a closed union — but that only protects call sites this
// repo's own `tsc --build` actually covers (samples and external consumers
// aren't in that project graph). The renderer's actionIconFor
// (renderer/src/web/primitives/index.tsx) already falls back to "no icon"
// for an unregistered key instead of crashing — this check makes the same
// gap fail loudly at boot instead of silently at render.
function isRegisteredIcon(icon: IconKey): boolean {
  return isOneOf(NAV_ICON_KEYS, icon);
}

export function validateActionHasIcon(
  featureName: string,
  screenId: string,
  screenType: "projectionDetail" | "entityEdit" | "entityList" | "projectionList" | "dashboard",
  context: string,
  action: { readonly id: string; readonly icon?: IconKey },
): void {
  const resolved = resolveActionIcon(action.id, action.icon);
  if (resolved === undefined || !isRegisteredIcon(resolved)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${context} "${action.id}" has no ` +
        `resolvable icon — set icon to a key registered in NAV_ICONS, or use an id that resolves one of ` +
        `its kebab segments via the default icon map (resolveActionIcon).`,
    );
  }
}

// Pin an action's declarative field references against the entity
// fields — a typo in pick/map source fields or visible.field would otherwise
// silently yield `undefined` in the payload or permanently wrong visibility
// (same "typo only surfaces on click" class as navigate/handler). Exported for
// query-output-columns.ts, which reuses it against a projectionDetail's
// outputSchema-derived record shape instead of an entity's field map
// (relatedList toolbarActions' visible/params).
export function validateActionFieldRefs(
  featureName: string,
  screenId: string,
  actionKind: "rowAction" | "toolbarAction",
  actionId: string,
  action: RowAction | ToolbarAction | RelatedListToolbarAction,
  fieldNames: ReadonlySet<string>,
  rowMeta: ReadonlySet<string>,
): void {
  // ToolbarAction.payload is a STATIC record (no row context) — only real
  // pick/map extractors are checked against the field names.
  const isExtractor = (v: unknown): v is RowFieldExtractor =>
    typeof v === "object" && v !== null && ("pick" in v || "map" in v);
  const payload = "payload" in action && isExtractor(action.payload) ? action.payload : undefined;
  const params = "params" in action && isExtractor(action.params) ? action.params : undefined;
  const visible: FieldCondition | undefined = "visible" in action ? action.visible : undefined;
  const entityId: string | undefined = "entityId" in action ? action.entityId : undefined;
  const known = () => [...fieldNames].sort().join(", ") || "(none)";
  const checkExtractor = (label: string, extractor: RowFieldExtractor | undefined): void => {
    // skip: the extractor is an optional action slot — without it there are
    // no field references to validate.
    if (extractor === undefined) {
      return;
    }
    const sources = "pick" in extractor ? extractor.pick : Object.values(extractor.map);
    for (const source of sources) {
      if (rowMeta.has(source)) continue;
      if (!fieldNames.has(source)) {
        throw new Error(
          `[Feature ${featureName}] Screen "${screenId}" ${actionKind} "${actionId}" ` +
            `${label} references unknown field "${source}". Known fields: ${known()}.`,
        );
      }
    }
  };
  checkExtractor("payload", payload);
  checkExtractor("params", params);
  if (
    visible !== undefined &&
    typeof visible !== "boolean" &&
    !rowMeta.has(visible.field) &&
    !fieldNames.has(visible.field)
  ) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" ${actionKind} "${actionId}" ` +
        `visible.field references unknown field "${visible.field}". Known fields: ${known()}.`,
    );
  }
  if (entityId !== undefined && entityId !== "id" && !fieldNames.has(entityId)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" ${actionKind} "${actionId}" ` +
        `entityId references unknown field "${entityId}". Known fields: ${known()}.`,
    );
  }
}

// Two features registering the same short screen-id is a silent routing
// footgun: create-app.tsx's runtime router resolves a bare navigate-target
// id by scanning features[] and taking the first match — the collision
// never surfaces as an error, the second feature's screen is just
// unreachable by that id (and always the same one that loses, in whatever
// order the app composed its features).
export function validateScreenShortIdCollisions(
  screensByShortId: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly featureName: string; readonly screen: ScreenDefinition }>
  >,
): void {
  for (const [shortId, entries] of screensByShortId) {
    const featureNames = new Set(entries.map((e) => e.featureName));
    if (featureNames.size > 1) {
      throw new Error(
        `Screen short-id "${shortId}" is registered by ${featureNames.size} features ` +
          `(${[...featureNames].join(", ")}) — the runtime router resolves a bare navigate-target ` +
          `id by taking the first match, so all but one of these screens would be unreachable by ` +
          `that id. Give each screen a distinct id.`,
      );
    }
  }
}

// redirect/cancelTarget accept either a same-feature short id (unchanged
// behavior, qualified against the owning feature) or a fully-qualified
// cross-feature screen QN (`<feature>:screen:<id>`) given verbatim — a
// short id can never itself be a valid QN (QN_SEGMENT forbids colons), so
// the two forms don't collide.
export function resolveScreenTargetQn(featureName: string, target: string): string {
  return isValidQn(target) ? target : qualifyEntityName(featureName, "screen", target);
}

export function validateScreenNavTarget(
  featureName: string,
  screenId: string,
  screenKind: string,
  fieldName: string,
  value: string,
  allScreenQns: ReadonlySet<string>,
  screens: FeatureDefinition["screens"],
): void {
  const candidateQn = resolveScreenTargetQn(featureName, value);
  if (!allScreenQns.has(candidateQn)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) ${fieldName} "${value}" ` +
        `does not resolve to a registered screen (checked "${candidateQn}"). Known screens ` +
        `in this feature: ${[...Object.keys(screens)].sort().join(", ") || "(none)"}.`,
    );
  }
}

// kind:"drawer" resolves same-feature only — unlike navigate/redirect,
// which the runtime router resolves app-wide (see the comment on
// buildScreenValidationContext in screens.ts), the drawer mounts the target inline using this
// feature's schema, so a cross-feature reference could never actually
// render. Two distinct failure messages: dangling reference vs. wrong
// screen type. Shared by ToolbarAction and RowAction drawer variants —
// same target-resolution rule, only the label in the error message
// ("toolbarAction" vs. "rowAction" vs. "action") differs.
export function validateDrawerTargetAction(
  featureName: string,
  screenId: string,
  screenKind: string,
  actionLabel: "toolbarAction" | "rowAction" | "emptyState action" | "action",
  action: {
    readonly id: string;
    readonly screen: string;
    readonly params?: RowFieldExtractor;
  },
  screens: FeatureDefinition["screens"],
): void {
  const target = screens[action.screen];
  if (target === undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) ${actionLabel} "${action.id}" ` +
        `drawer-target "${action.screen}" does not resolve to a registered screen in this feature. ` +
        `kind:"drawer" only resolves same-feature screens (unlike kind:"navigate", which can target ` +
        `screens in any feature) — the drawer mounts the target inline using this feature's schema. ` +
        `Known screens in this feature: ${[...Object.keys(screens)].sort().join(", ") || "(none)"}.`,
    );
  }
  // secretMint is intentionally excluded — a one-time secret reveal belongs on
  // its own page, not layered in a Drawer above a list.
  if (target.type !== "actionForm") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) ${actionLabel} "${action.id}" ` +
        `drawer-target "${action.screen}" is a "${target.type}" screen, not an actionForm. ` +
        `kind:"drawer" mounts an actionForm inside a Drawer widget — point "screen" at an ` +
        `actionForm screen, or use kind:"navigate" for a full-page target.`,
    );
  }
  // The renderer (mergeSearchParamsIntoInitial) silently drops a prefill key
  // when the target doesn't declare the field, marks it sensitive/password,
  // or doesn't render it in its layout — each would only show up as an empty
  // field at click time.
  // skip: no params extractor — nothing to check against the target's fields.
  if (action.params === undefined) return;
  validateDrawerPrefillKeys(
    `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) ${actionLabel} "${action.id}"`,
    "drawer-target",
    action.screen,
    target,
    action.params,
  );
}

function renderedEditFieldNames(sections: EditLayout["sections"]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const section of sections) {
    if (!isFieldsEditSection(section)) continue;
    for (const spec of sectionFieldSpecs(section)) names.add(normalizeEditField(spec).field);
  }
  return names;
}

export function isSensitiveOrPasswordField(field: object | undefined): boolean {
  return (
    field !== undefined &&
    (("sensitive" in field && field.sensitive === true) ||
      ("writeOnly" in field && field.writeOnly === true) ||
      ("format" in field && field.format === "password"))
  );
}

export function validateDrawerPrefillKeys(
  where: string,
  targetLabel: "drawer-target" | "navigate-target",
  targetScreenId: string,
  target: ActionFormScreenDefinition | SecretMintScreenDefinition,
  params: RowFieldExtractor,
): void {
  const renderedFieldNames = renderedEditFieldNames(target.layout.sections);
  for (const fieldName of rowFieldExtractorKeys(params)) {
    // A `load` form reads only the record id from these params, never a value.
    if (fieldName === "id" && target.type === "actionForm" && target.load !== undefined) continue;
    if (!Object.hasOwn(target.fields, fieldName)) {
      throw new Error(
        `${where} params prefills "${fieldName}", which ${targetLabel} "${targetScreenId}" does not declare as a ` +
          `field — the renderer would drop it and leave the form empty. Target fields: ` +
          `${Object.keys(target.fields).sort().join(", ") || "(none)"}.`,
      );
    }
    if (isSensitiveOrPasswordField(target.fields[fieldName])) {
      throw new Error(
        `${where} params prefills "${fieldName}", which ${targetLabel} "${targetScreenId}" marks as ` +
          `sensitive or password — the renderer never prefills those fields and would leave the form empty. Remove that param or prefill a non-sensitive field.`,
      );
    }
    if (!renderedFieldNames.has(fieldName)) {
      throw new Error(
        `${where} params prefills "${fieldName}", which ${targetLabel} "${targetScreenId}" does not render in ` +
          `its layout — the renderer only prefills fields the layout shows and would drop it.`,
      );
    }
  }
}

// A navigate rowAction (or projectionDetail header action, which
// reuses the same RowActionNavigate shape) names its target as either a
// screen (existing) or an entity (new) — exactly one. Shared by all three
// call sites so the mutual-exclusivity check and the entity→detailFor
// resolution don't drift between them (same drift risk
// validateRowActionNavigateParams above is already shared to avoid).
// Runtime-loose shape: boot still rejects both/neither for untyped schemas;
// authors get the exclusive union via RowActionNavigate.
type RowActionNavigateRuntime = RowActionNavigateBase & {
  readonly screen?: string;
  readonly entity?: string;
};

// The target can be any screen, so this checks the resolved target's
// sections, not the host's.
function validateRowActionNavigateTab(
  featureName: string,
  screenId: string,
  screenType: NavigateSourceScreenType,
  actionLabel: string,
  action: RowActionNavigateRuntime,
  target: { readonly featureName: string; readonly screen: ScreenDefinition } | undefined,
): void {
  // skip: no tab declared — nothing to check against the target's sections
  if (action.tab === undefined) return;
  if (target === undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
        `sets tab "${action.tab}", but its navigate-target could not be resolved to a screen. Point the navigate-target at a registered screen.`,
    );
  }
  if (target.screen.type !== "projectionDetail" || target.screen.layout.mode !== "tabs") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
        `sets tab "${action.tab}", but navigate-target screen "${target.screen.id}" is not a ` +
        `projectionDetail with layout.mode "tabs" — only those read the tab param. Remove the tab or navigate to a projectionDetail screen with layout.mode "tabs".`,
    );
  }
  const sectionIds = target.screen.layout.sections
    .map((section) => section.id)
    .filter((id): id is string => id !== undefined);
  if (!sectionIds.includes(action.tab)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
        `navigates to tab "${action.tab}", which is not a section id on target screen ` +
        `"${target.screen.id}". Available: ${sectionIds.join(", ") || "(none)"}.`,
    );
  }
}

export function resolveRowActionNavigateTarget(
  featureName: string,
  screenId: string,
  screenType: NavigateSourceScreenType,
  actionLabel: string,
  action: RowActionNavigateRuntime,
  allScreenQns: ReadonlySet<string>,
  navTargetShortIds: ReadonlySet<string>,
  screensByShortId: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly featureName: string; readonly screen: ScreenDefinition }>
  >,
  detailForScreens: ReadonlyMap<
    string,
    { readonly featureName: string; readonly screen: ScreenDefinition }
  >,
): { readonly featureName: string; readonly screen: ScreenDefinition } | undefined {
  if (action.entity !== undefined) {
    if (action.screen !== undefined) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
          `sets both "screen" and "entity" — exactly one navigate-target form is allowed.`,
      );
    }
    if (screenType !== "entityList" && action.entityId === undefined) {
      // entityList rows are always a real entity record, so row["id"] is a
      // safe implicit default. projectionList/projectionDetail rows come from
      // an arbitrary query projection with no guaranteed "id" field — an
      // entity-target there needs an explicit entityId, or navigation silently
      // opens the detail screen with no entity context at runtime.
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
          `navigate-target entity "${action.entity}" needs an explicit "entityId" — ${screenType} rows ` +
          `come from a query projection with no guaranteed "id" field.`,
      );
    }
    const detail = detailForScreens.get(action.entity);
    if (detail === undefined) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
          `navigate-target entity "${action.entity}" has no screen declaring ` +
          `detailFor: "${action.entity}". Add detailFor: "${action.entity}" to a screen or navigate to a screen directly.`,
      );
    }
    validateRowActionNavigateTab(featureName, screenId, screenType, actionLabel, action, detail);
    return detail;
  }
  if (action.screen === undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
        `sets neither "screen" nor "entity" — exactly one navigate-target form is required.`,
    );
  }
  const candidateQn = qualifyEntityName(featureName, "screen", action.screen);
  if (!allScreenQns.has(candidateQn) && !navTargetShortIds.has(action.screen)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
        `navigate-target "${action.screen}" does not resolve to a registered screen in any feature. Use "<feature>:screen:<id>" of an existing screen.`,
    );
  }
  const target = screensByShortId.get(action.screen)?.[0];
  validateRowActionNavigateTab(featureName, screenId, screenType, actionLabel, action, target);
  return target;
}

// redirect is either a short screen id (same-feature, e.g. "item-list") or
// a fully-qualified cross-feature QN (`<feature>:screen:<id>`) — the
// renderer strips the latter to the short id (lastSegment) when
// navigating, which the nav-router resolves app-wide. The object
// form carries the same target under `screen` plus the payload
// field `idFrom`. Shared by actionForm/secretMint (validateInlineFormNavTargets)
// and entityEdit — same rule, same error message, one place to keep them in sync.
export function validateRedirectTarget(
  feature: FeatureDefinition,
  screenId: string,
  screenKind: "actionForm" | "secretMint" | "entityEdit" | "projectionDetail",
  redirect: string | ActionFormRedirect,
  lookups: NavigateTargetLookups,
  // Property name used in error messages (`successLinks[0]` for a success link).
  propertyPath = "redirect",
): void {
  const { allScreenQns } = lookups;
  const redirectTarget = typeof redirect === "string" ? redirect : redirect.screen;
  if (
    typeof redirect !== "string" &&
    (typeof redirect.idFrom !== "string" || redirect.idFrom.trim() === "")
  ) {
    throw new Error(
      `[Feature ${feature.name}] Screen "${screenId}" (${screenKind}) ${propertyPath}.idFrom is empty or not a string — ` +
        `name the success-payload field carrying the navigation id, or use the plain string ` +
        `redirect form to navigate with the handler's own "id".`,
    );
  }
  // The renderer reads idFrom verbatim (Object.hasOwn), so stray whitespace
  // never matches and the navigation silently lands without an entityId.
  if (typeof redirect !== "string" && redirect.idFrom !== redirect.idFrom.trim()) {
    throw new Error(
      `[Feature ${feature.name}] Screen "${screenId}" (${screenKind}) ${propertyPath}.idFrom "${redirect.idFrom}" ` +
        `has leading/trailing whitespace — it would never match a payload field. Remove the whitespace from idFrom.`,
    );
  }
  validateScreenNavTarget(
    feature.name,
    screenId,
    screenKind,
    propertyPath,
    redirectTarget,
    allScreenQns,
    feature.screens,
  );
  // idFrom only means something to a target that carries a record id; the
  // renderer drops it silently otherwise. Cross-feature QN targets can't be
  // typed from here and stay unchecked.
  const sameFeatureTarget = feature.screens[redirectTarget];
  if (
    typeof redirect !== "string" &&
    sameFeatureTarget !== undefined &&
    sameFeatureTarget.type !== "entityEdit" &&
    sameFeatureTarget.type !== "projectionDetail"
  ) {
    throw new Error(
      `[Feature ${feature.name}] Screen "${screenId}" (${screenKind}) ${propertyPath}.idFrom is set but target screen ` +
        `"${redirectTarget}" (${sameFeatureTarget.type}) carries no id — use the plain string form.`,
    );
  }
  if (typeof redirect !== "string" && redirect.tab !== undefined) {
    validateRowActionNavigateTab(
      feature.name,
      screenId,
      screenKind,
      propertyPath,
      { kind: "navigate", id: redirectTarget, label: redirectTarget, tab: redirect.tab },
      findNavTargetEntry(feature, redirectTarget, lookups),
    );
  }
}

function findNavTargetEntry(
  feature: FeatureDefinition,
  target: string,
  lookups: NavigateTargetLookups,
) {
  const targetQn = resolveScreenTargetQn(feature.name, target);
  return lookups.screensByShortId
    .get(targetQn.slice(targetQn.lastIndexOf(":") + 1))
    ?.find((entry) => qualifyEntityName(entry.featureName, "screen", entry.screen.id) === targetQn);
}

// A success link without idFrom navigates without an id, so its target must not
// be a record screen (entityEdit/projectionDetail need one).
export function validateIdlessSuccessLink(
  feature: FeatureDefinition,
  screenId: string,
  screenKind: "actionForm",
  link: ActionFormSuccessLink,
  lookups: NavigateTargetLookups,
  propertyPath: string,
): void {
  validateScreenNavTarget(
    feature.name,
    screenId,
    screenKind,
    propertyPath,
    link.screen,
    lookups.allScreenQns,
    feature.screens,
  );
  const target = findNavTargetEntry(feature, link.screen, lookups);
  const targetType = target?.screen.type;
  if (targetType === "entityEdit" || targetType === "projectionDetail") {
    throw new Error(
      `[Feature ${feature.name}] Screen "${screenId}" (${screenKind}) ${propertyPath} targets "${link.screen}" ` +
        `(${targetType}), a record screen — set ${propertyPath}.idFrom to the success-payload field carrying the record id.`,
    );
  }
  if (link.tab !== undefined) {
    validateRowActionNavigateTab(
      feature.name,
      screenId,
      screenKind,
      propertyPath,
      { kind: "navigate", id: link.screen, label: link.screen, tab: link.tab },
      target,
    );
  }
}

// A clientAction names a handler a client feature registers
// (ClientFeatureDefinition.clientActions). Nothing server-side can confirm the
// registration, so the shape is the only boot-time check.
export function validateClientActionName(
  featureName: string,
  screenId: string,
  screenKind: string,
  actionLabel: "rowAction" | "emptyState action" | "action",
  action: Extract<RowAction, { readonly kind: "clientAction" }>,
): void {
  const segments = action.action.split(":");
  const [scope, name] = segments;
  const wellFormed =
    segments.length === 2 &&
    scope !== undefined &&
    name !== undefined &&
    isKebabSegment(scope) &&
    isKebabSegment(name);
  // skip: well-formed name, nothing to reject
  if (wellFormed) return;
  throw new Error(
    `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) ${actionLabel} "${action.id}" ` +
      `action "${action.action}" is not a client action name — expected "<feature>:<kebab-name>", ` +
      `e.g. "auth-email-password:request-password-reset".`,
  );
}

// redirect is only honored on record actions; on list/related-list row
// actions it would be silently dropped, so the author would believe it works.
export function rejectRedirectOnListRowAction(
  featureName: string,
  screenId: string,
  screenKind: string,
  action: RowAction,
): void {
  if (
    action.kind !== "navigate" &&
    action.kind !== "drawer" &&
    action.kind !== "clientAction" &&
    action.redirect !== undefined
  ) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) rowAction "${action.id}" sets redirect — ` +
        `redirect is only honored on record actions (projectionDetail/entityEdit header and section ` +
        `actions) and is ignored on list row actions. Remove it.`,
    );
  }
}

// A writeHandler record action's redirect (projectionDetail/entityEdit
// header and section actions) follows the entityEdit.redirect rule.
export function validateRecordActionRedirect(
  feature: FeatureDefinition,
  screenId: string,
  screenKind: "projectionDetail" | "entityEdit",
  action: RowAction,
  lookups: NavigateTargetLookups,
): void {
  if (
    action.kind !== "navigate" &&
    action.kind !== "drawer" &&
    action.kind !== "clientAction" &&
    action.redirect !== undefined
  ) {
    validateRedirectTarget(feature, screenId, screenKind, action.redirect, lookups);
  }
}

// "edit" is the default edit action, which only exists when detailFor names
// the entity; a typo would otherwise silently fall back to the default header layout.
export function validatePrimaryActionTarget(
  featureName: string,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
): void {
  const targets: ReadonlyArray<readonly [option: string, id: string]> = [
    ...(screen.primaryAction !== undefined
      ? [["primaryAction", screen.primaryAction] as const]
      : []),
    ...(screen.inlineActions ?? []).map((id) => ["inlineActions", id] as const),
  ];
  const declaredIds = (screen.actions ?? []).map((action) => action.id);
  const editIsAvailable = screen.detailFor !== undefined;
  for (const [option, id] of targets) {
    if (declaredIds.includes(id) || (editIsAvailable && id === "edit")) continue;
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) ${option} "${id}" ` +
        `matches no action — use one of the declared action ids (${declaredIds.join(", ") || "none declared"})` +
        `${editIsAvailable ? ' or "edit"' : ' ("edit" needs detailFor on this screen)'}.`,
    );
  }
}

export function validateScreenVisibleWhen(
  feature: FeatureDefinition,
  screenId: string,
  screen: ScreenDefinition,
  allScreenQns: ReadonlySet<string>,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const { visibleWhen, fallback } = screen;
  const context = `[Feature ${feature.name}] Screen "${screenId}" (${screen.type})`;
  if (visibleWhen === undefined && fallback !== undefined) {
    throw new Error(
      `${context} declares fallback without visibleWhen. Add visibleWhen or remove fallback.`,
    );
  }
  if (visibleWhen !== undefined && (visibleWhen.query === "" || visibleWhen.field === "")) {
    throw new Error(
      `${context} visibleWhen needs a non-empty query and field. Set both visibleWhen.query and visibleWhen.field.`,
    );
  }
  if (fallback !== undefined) {
    validateScreenFallback(feature, screenId, screen.type, fallback, allScreenQns, featureMap);
  }
}

function assertFallbackMapShape(context: string, fallback: ScreenFallbackByReason): void {
  const reasons = Object.keys(fallback);
  if (reasons.length === 0) {
    throw new Error(
      `${context} fallback map is empty. Set at least one of ${SCREEN_FALLBACK_REASONS.join(", ")} or use a screen id string.`,
    );
  }
  const unknownReason = reasons.find((reason) => !isOneOf(SCREEN_FALLBACK_REASONS, reason));
  if (unknownReason !== undefined) {
    throw new Error(
      `${context} fallback has unknown reason "${unknownReason}". Use ${SCREEN_FALLBACK_REASONS.join(", ")}.`,
    );
  }
}

function validateScreenFallback(
  feature: FeatureDefinition,
  screenId: string,
  screenType: ScreenDefinition["type"],
  fallback: ScreenFallback,
  allScreenQns: ReadonlySet<string>,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  if (typeof fallback !== "string") {
    assertFallbackMapShape(
      `[Feature ${feature.name}] Screen "${screenId}" (${screenType})`,
      fallback,
    );
  }
  for (const target of fallbackTargets(fallback)) {
    validateFallbackTarget(feature, screenId, screenType, target, allScreenQns, featureMap);
  }
}

function validateFallbackTarget(
  feature: FeatureDefinition,
  screenId: string,
  screenType: ScreenDefinition["type"],
  fallback: string,
  allScreenQns: ReadonlySet<string>,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const context = `[Feature ${feature.name}] Screen "${screenId}" (${screenType})`;
  validateScreenNavTarget(
    feature.name,
    screenId,
    screenType,
    "fallback",
    fallback,
    allScreenQns,
    feature.screens,
  );
  const fallbackQn = resolveScreenTargetQn(feature.name, fallback);
  if (fallbackQn === qualifyEntityName(feature.name, "screen", screenId)) {
    throw new Error(
      `${context} fallback points at the screen itself. Point fallback at a different screen.`,
    );
  }
  // A gated fallback could hide in turn and chain or cycle (A→B→A); one hop keeps the
  // runtime gate trivially terminating.
  const [fallbackFeatureName = "", , fallbackShortId = ""] = fallbackQn.split(":");
  if (featureMap.get(fallbackFeatureName)?.screens[fallbackShortId]?.visibleWhen !== undefined) {
    throw new Error(
      `${context} fallback "${fallback}" has its own visibleWhen; a fallback must always render.`,
    );
  }
}

export type NavigateTargetLookups = {
  readonly allScreenQns: ReadonlySet<string>;
  readonly navTargetShortIds: ReadonlySet<string>;
  readonly screensByShortId: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly featureName: string; readonly screen: ScreenDefinition }>
  >;
  readonly detailForScreens: ReadonlyMap<
    string,
    { readonly featureName: string; readonly screen: ScreenDefinition }
  >;
};

// Only a navigate action that sets `tab` needs the target resolved (to check
// the tab id); plain navigates are validated elsewhere. One place for every
// section-level action site so a new site can't forget the tab check.
export function validateNavigateActionTab(
  featureName: string,
  screenId: string,
  screenType: NavigateSourceScreenType,
  actionLabel: string,
  action: RowAction,
  lookups: NavigateTargetLookups,
): void {
  // skip: only navigate actions with an explicit tab need target validation
  if (action.kind !== "navigate" || action.tab === undefined) return;
  resolveRowActionNavigateTarget(
    featureName,
    screenId,
    screenType,
    actionLabel,
    action,
    lookups.allScreenQns,
    lookups.navTargetShortIds,
    lookups.screensByShortId,
    lookups.detailForScreens,
  );
}

export function assertWriteHandlerRegistered(
  featureName: string,
  subject: string,
  handler: string,
  allWriteHandlerQns: ReadonlySet<string>,
): void {
  if (!allWriteHandlerQns.has(handler)) {
    throw new Error(
      `[Feature ${featureName}] ${subject} handler "${handler}" ` +
        `is not a registered write-handler. Check the QN spelling (expected ` +
        `"<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
    );
  }
}
