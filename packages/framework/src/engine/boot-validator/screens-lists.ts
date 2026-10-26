import { SELECT_OPTION_TONES } from "@cosmicdrift/kumiko-types/fields";
import type { NavDefinition } from "@cosmicdrift/kumiko-types/nav";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { REFERENCE_LOOKUP_SOURCES } from "../../ui-types/list-row-meta.ts";
import { parseRefTarget } from "../parse-ref-target.ts";
import { qualifyEntityName } from "../qualified-name.ts";
import {
  explicitListScreenId,
  normalizeListColumn,
  resolveNavParentScreen,
} from "../screen-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";

import type {
  EditRelatedListSection,
  ListColumnSpec,
  ListFacetSpec,
  RowAction,
  ScreenDefinition,
} from "../types/screen.ts";
import { validateListBulkActions } from "./list-bulk-actions.ts";
import { validateListTableOptions } from "./list-table-options.ts";
import { validateRelatedListGroupingRules } from "./related-list-table-rules.ts";
import type { NavigateSourceScreenType, NavigateTargetLookups } from "./screens-actions.ts";
import {
  assertWriteHandlerRegistered,
  isRowClickAction,
  rejectRedirectOnListRowAction,
  resolveRowActionNavigateTarget,
  validateClientActionName,
  validateDrawerTargetAction,
  validateRowActionNavigateParams,
} from "./screens-actions.ts";
import { isSelectOptionTone } from "./select-option-tone.ts";

type NavAreaIndex = {
  readonly anyNavRegistered: boolean;
  // nav.screen is a full QN (cross-feature): every screen QN a standalone
  // r.nav() entry or one of its actions points at.
  readonly navTargetQns: ReadonlySet<string>;
  readonly allScreens: readonly ScreenDefinition[];
};

// validateScreenHasNavArea runs once per screen; the index is built once per
// featureMap (immutable during boot) instead of re-scanning every feature each call.
const navAreaIndexByFeatureMap = new WeakMap<
  ReadonlyMap<string, FeatureDefinition>,
  NavAreaIndex
>();

function navTargetScreenQns(nav: NavDefinition): readonly string[] {
  return [nav.screen, nav.createAction?.screen, ...(nav.actions ?? []).map((a) => a.screen)].filter(
    (qn): qn is string => qn !== undefined,
  );
}

function getNavAreaIndex(featureMap: ReadonlyMap<string, FeatureDefinition>): NavAreaIndex {
  const cached = navAreaIndexByFeatureMap.get(featureMap);
  if (cached !== undefined) return cached;
  const navTargetQns = new Set<string>();
  const allScreens: ScreenDefinition[] = [];
  let anyNavRegistered = false;
  for (const f of featureMap.values()) {
    allScreens.push(...Object.values(f.screens));
    for (const nav of Object.values(f.navs)) {
      anyNavRegistered = true;
      for (const qn of navTargetScreenQns(nav)) navTargetQns.add(qn);
    }
  }
  const index: NavAreaIndex = { anyNavRegistered, navTargetQns, allScreens };
  navAreaIndexByFeatureMap.set(featureMap, index);
  return index;
}

// resolveNavParentScreen falls back to a heuristic when the explicit
// listScreenId matches no screen, so a typo would silently get the guess.
export function validateExplicitListScreenExists(
  featureName: string,
  screenId: string,
  screen: ScreenDefinition,
  screensByShortId: ReadonlyMap<string, unknown>,
): void {
  const listScreenId = explicitListScreenId(screen);
  // skip: no explicit listScreenId, the nav heuristic applies and there is nothing to validate
  if (listScreenId === undefined) return;
  const shortId = listScreenId.slice(listScreenId.lastIndexOf(":") + 1);
  // skip: the explicit listScreenId resolves to a mounted screen
  if (screensByShortId.has(shortId)) return;
  throw new Error(
    `[Feature ${featureName}] Screen "${screenId}" (${screen.type}) listScreenId "${listScreenId}" ` +
      `matches no mounted screen — fix the id or mount the list screen.`,
  );
}

// Every screen must resolve nav via `nav`, `r.nav()`, a parent list, or
// `dormant: true`. Skipped when the composed set has no nav entries at all.
export function validateScreenHasNavArea(
  feature: FeatureDefinition,
  screenId: string,
  screen: ScreenDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  // skip: the screen already declares its own nav entry.
  if (screen.nav !== undefined) return;
  // skip: explicitly opted out via `dormant: true`.
  if (screen.dormant === true) return;
  const { anyNavRegistered, navTargetQns, allScreens } = getNavAreaIndex(featureMap);
  // skip: no nav entries exist anywhere in the composed set — a feature/
  // recipe/test fixture booted without an app shell, not an omission.
  if (!anyNavRegistered) return;
  const targetQn = qualifyEntityName(feature.name, "screen", screenId);
  // skip: a standalone r.nav() elsewhere already points at this screen.
  if (navTargetQns.has(targetQn)) return;
  // skip: resolves to a parent list via listScreenId/rowAction-target/same-entity.
  if (resolveNavParentScreen(allScreens, screen, (s) => s.id) !== undefined) return;
  throw new Error(
    `[Feature ${feature.name}] Screen "${targetQn}" has no nav entry and no resolvable list — ` +
      `declare listScreenId (or a rowAction/toolbarAction navigate target from a list screen), add ` +
      `a standalone r.nav() pointing at it, or set dormant: true if it's intentionally reachable ` +
      `only via a direct link/redirect or a consuming app's own r.nav().`,
  );
}

type RelatedListSectionValidation = {
  readonly featureName: string;
  readonly featureMap: ReadonlyMap<string, FeatureDefinition>;
  readonly screenId: string;
  readonly screenType: NavigateSourceScreenType;
  readonly where: string;
  readonly section: EditRelatedListSection;
  readonly screens: FeatureDefinition["screens"];
  readonly allWriteHandlerQns: ReadonlySet<string>;
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

// Shared by projectionDetail relatedList sections and entityList.expandableRow:
// both render a relatedList whose rows come from an arbitrary query.
function validateRelatedListTableAndBulk(args: RelatedListSectionValidation): void {
  const { featureName, where, section } = args;
  validateRelatedListGroupingRules(
    `[Feature ${featureName}] ${where}`,
    section,
    args.screenType === "entityList expandableRow",
  );
  validateListTableOptions(`[Feature ${featureName}] ${where}`, section.table, section.columns);
  if (section.rowActions !== undefined) validateRelatedListRowActions(args, section.rowActions);
  validateListBulkActions(
    `[Feature ${featureName}] ${where}`,
    section.bulkActions,
    section.rowActions,
  );
}

export function validateRelatedListSection(args: RelatedListSectionValidation): void {
  const { featureName, featureMap, where, section } = args;
  if (!section.query || typeof section.query !== "string") {
    throw new Error(
      `[Feature ${featureName}] ${where} has empty or non-string query. Set query to a registered query name.`,
    );
  }
  if (section.entity !== undefined) {
    assertRefTargetRegistered(
      `[Feature ${featureName}] ${where}`,
      "entity",
      section.entity,
      featureName,
      featureMap,
    );
  }
  for (const col of section.columns) {
    const normalizedCol = normalizeListColumn(col);
    validateEnumOptionTones(`[Feature ${featureName}] ${where}`, normalizedCol);
    if (normalizedCol.refEntity !== undefined) {
      assertRefTargetRegistered(
        `[Feature ${featureName}] ${where}`,
        `column "${normalizedCol.field}" (refEntity)`,
        normalizedCol.refEntity,
        featureName,
        featureMap,
      );
    }
  }
  if (section.rowClick !== undefined) {
    const targetEntity = section.rowClick.entity;
    const hasDetailScreen = [...featureMap.values()].some((f) =>
      Object.values(f.screens).some((s) => s.detailFor === targetEntity),
    );
    if (!hasDetailScreen) {
      throw new Error(
        `[Feature ${featureName}] ${where} ` +
          `rowClick targets entity "${targetEntity}", but no screen declares ` +
          `detailFor: "${targetEntity}". Add detailFor: "${targetEntity}" to the screen that shows it.`,
      );
    }
  }
  validateRelatedListTableAndBulk(args);
  if (section.defaultSort !== undefined) validateRelatedListDefaultSort(args, section.defaultSort);
  if (section.facets !== undefined) {
    validateListFacets(
      `[Feature ${featureName}] ${where}`,
      section.facets,
      section.columns,
      featureName,
      featureMap,
    );
  }
  if (section.toolbarActions !== undefined) {
    validateRelatedListToolbarActions(args, section.toolbarActions);
  }
}

export type ListActionTargetContext = NavigateTargetLookups & {
  readonly featureName: string;
  readonly screenId: string;
  readonly screenType: NavigateSourceScreenType;
  readonly screenEntity: string | undefined;
  readonly where: string;
  readonly screens: FeatureDefinition["screens"];
  readonly allWriteHandlerQns: ReadonlySet<string>;
};

// An empty list has no row, so params resolve against an empty record.
function rejectEmptyStateActionParams(
  ctx: ListActionTargetContext,
  actionLabel: "rowAction" | "emptyState action",
  action: RowAction,
): void {
  const params = action.kind === "navigate" || action.kind === "drawer" ? action.params : undefined;
  if (params !== undefined) {
    throw new Error(
      `[Feature ${ctx.featureName}] ${ctx.where} ${actionLabel} "${action.id}" sets params — an empty list ` +
        `has no row to read them from, so they would resolve against an empty record. Remove the params.`,
    );
  }
}

// Target checks shared by list/related-list rowActions and emptyState.action:
// navigate target + params, drawer target, write-handler registration.
export function validateListActionTargets(
  ctx: ListActionTargetContext,
  actionLabel: "rowAction" | "emptyState action",
  action: RowAction,
): void {
  rejectRedirectOnListRowAction(ctx.featureName, ctx.screenId, ctx.screenType, action);
  if (actionLabel === "emptyState action") rejectEmptyStateActionParams(ctx, actionLabel, action);
  validateRowActionTarget(ctx, actionLabel, actionLabel, action);
}

// Header actions have always reported navigate-params errors under the
// "rowAction" label, which validateRowActionNavigateParams only knows in list
// labels — hence paramsLabel apart from actionLabel.
export function validateRowActionTarget(
  ctx: ListActionTargetContext,
  actionLabel: "rowAction" | "emptyState action" | "action",
  paramsLabel: "rowAction" | "emptyState action",
  action: RowAction,
): void {
  const { featureName, screenId, screenType } = ctx;
  if (action.kind === "navigate") {
    const target = resolveRowActionNavigateTarget(
      featureName,
      screenId,
      screenType,
      actionLabel,
      action,
      ctx.allScreenQns,
      ctx.navTargetShortIds,
      ctx.screensByShortId,
      ctx.detailForScreens,
    );
    validateRowActionNavigateParams(
      featureName,
      screenId,
      screenType,
      ctx.screenEntity,
      action,
      target,
      paramsLabel,
    );
  } else if (action.kind === "drawer") {
    validateDrawerTargetAction(featureName, screenId, screenType, actionLabel, action, ctx.screens);
  } else if (action.kind === "clientAction") {
    validateClientActionName(featureName, screenId, screenType, actionLabel, action);
  } else {
    assertWriteHandlerRegistered(
      featureName,
      `${ctx.where} ${actionLabel} "${action.id}"`,
      action.handler,
      ctx.allWriteHandlerQns,
    );
  }
}

function validateRelatedListRowActions(
  args: RelatedListSectionValidation,
  rowActions: NonNullable<EditRelatedListSection["rowActions"]>,
): void {
  const {
    featureName,
    screenId,
    screenType,
    where,
    section,
    screens,
    allWriteHandlerQns,
    allScreenQns,
    navTargetShortIds,
    screensByShortId,
    detailForScreens,
  } = args;
  for (const action of rowActions) {
    validateListActionTargets(
      {
        featureName,
        screenId,
        screenType,
        screenEntity: undefined,
        where,
        screens,
        allWriteHandlerQns,
        allScreenQns,
        navTargetShortIds,
        screensByShortId,
        detailForScreens,
      },
      "rowAction",
      action,
    );
  }
  // section.rowClick (legacy, navigate-only) and a rowActions entry
  // marked rowClick:true both claim the row-body click — same
  // at-most-one constraint as entityList/projectionList's
  // validateAtMostOneRowClick, just spanning two fields instead of one.
  const rowClickActionCount = rowActions.filter(isRowClickAction).length;
  const legacyRowClickCount = section.rowClick !== undefined ? 1 : 0;
  if (rowClickActionCount + legacyRowClickCount > 1) {
    throw new Error(
      `[Feature ${featureName}] ${where} ` +
        `has both a rowClick and ${rowClickActionCount} rowActions marked ` +
        `rowClick:true — at most one may fire on a row-body click.`,
    );
  }
}

function validateRelatedListDefaultSort(
  args: RelatedListSectionValidation,
  defaultSort: NonNullable<EditRelatedListSection["defaultSort"]>,
): void {
  const { featureName, where, section } = args;
  const sortField = defaultSort.field;
  const col = section.columns.find((c) => normalizeListColumn(c).field === sortField);
  if (col === undefined) {
    throw new Error(
      `[Feature ${featureName}] ${where} ` +
        `defaultSort.field "${sortField}" is not a listed column. Use a listed column as defaultSort.field.`,
    );
  }
  if (normalizeListColumn(col).sortable !== true) {
    throw new Error(
      `[Feature ${featureName}] ${where} ` +
        `defaultSort.field "${sortField}" is not sortable. Set sortable: true on ` +
        `the column or pick another field.`,
    );
  }
}

// Only drawer-kind and navigate actions that set tab are validated here;
// plain navigate (no tab) and writeHandler toolbarActions have no boot check yet.
function validateRelatedListToolbarActions(
  args: RelatedListSectionValidation,
  toolbarActions: NonNullable<EditRelatedListSection["toolbarActions"]>,
): void {
  const {
    featureName,
    screenId,
    screenType,
    screens,
    allScreenQns,
    navTargetShortIds,
    screensByShortId,
    detailForScreens,
  } = args;
  for (const action of toolbarActions) {
    if (action.visibleWhen !== undefined) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) relatedList toolbarAction "${action.id}" sets visibleWhen, which only list-screen toolbars support. Use visible (a condition on the enclosing record) instead.`,
      );
    }
    if (action.kind === "drawer") {
      validateDrawerTargetAction(
        featureName,
        screenId,
        screenType,
        "toolbarAction",
        action,
        screens,
      );
    }
    if (action.kind === "navigate" && action.tab !== undefined) {
      resolveRowActionNavigateTarget(
        featureName,
        screenId,
        screenType,
        "toolbarAction",
        action,
        allScreenQns,
        navTargetShortIds,
        screensByShortId,
        detailForScreens,
      );
    }
  }
}

// Column-level sortable: true only enables relatedList headers. On entityList
// the entity field's flag wins; on projectionList sortable comes from the
// query schema and a column can only opt OUT with sortable: false.
export function rejectInertColumnSortable(
  featureName: string,
  screenId: string,
  screenType: "entityList" | "projectionList",
  column: { readonly field: string; readonly sortable?: boolean },
): void {
  const isInert =
    screenType === "entityList" ? column.sortable !== undefined : column.sortable === true;
  // skip: the sortable flag is meaningful for this screen type
  if (!isInert) return;
  const source =
    screenType === "entityList"
      ? "set sortable: true on the entity field instead"
      : "sorting is derived from the query's Zod schema; only sortable: false is honored";
  throw new Error(
    `[Feature ${featureName}] Screen "${screenId}" (${screenType}) column "${column.field}" sets sortable — ` +
      `it is ignored here; ${source}. Remove sortable from this column.`,
  );
}

// Form check for ListColumn renderers in the PlatformComponent form
// (`{ react: { __component: "Name" } }`). The server does not know the
// client-side columnRenderers map, so it only checks that the structure is
// right: if `react` is set as an object, `__component` MUST be a non-empty
// string. A key omitted on the client only triggers a warning, not a boot
// failure.
export function validateColumnRendererForm(
  featureName: string,
  screenId: string,
  column: { readonly field: string; readonly renderer?: unknown },
): void {
  validateEnumOptionTones(`[Feature ${featureName}] Screen "${screenId}"`, column);
  const renderer = column.renderer;
  // skip: only the PlatformComponent form ({ react: { __component: "..." } })
  // is validated structurally. Function, string-QN and null/undefined
  // renderers are all valid other forms — not a form error.
  if (renderer === null || typeof renderer !== "object") return;
  // @cast-boundary schema-walk — feature-config renderer-shape introspection
  const react = (renderer as { react?: unknown }).react;
  // skip: no react branch → either native-only or not a PlatformComponent —
  // both outside this check.
  if (react === undefined || react === null) return;
  if (typeof react !== "object") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" column "${column.field}" has a renderer with ` +
        `a non-object \`react\` branch — expected \`{ react: { __component: "Name" } }\`.`,
    );
  }
  // @cast-boundary schema-walk — feature-config react-branch introspection
  const component = (react as { __component?: unknown }).__component;
  // skip: without a __component key this is not the string-key form
  // (e.g. a future direct component ref); not our domain.
  if (component === undefined) return;
  if (typeof component !== "string" || component.length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" column "${column.field}" has a renderer with ` +
        `\`react.__component\` = ${JSON.stringify(component)} — expected a non-empty string identifying ` +
        `a client-side columnRenderers entry.`,
    );
  }
}

// A typo'd tone would silently fall back to the neutral pill.
export function validateEnumOptionTones(
  prefix: string,
  column: { readonly field: string; readonly renderer?: unknown },
): void {
  const { renderer } = column;
  const isEnumOption =
    typeof renderer === "object" &&
    renderer !== null &&
    propertyOf(renderer, "format") === "enumOption";
  const tones = isEnumOption ? propertyOf(renderer, "tones") : undefined;
  // skip: only an enumOption column with tones has tones to check.
  if (tones === undefined) return;
  const invalid =
    typeof tones !== "object" || tones === null
      ? [String(tones)]
      : Object.values(tones)
          .filter((tone) => !isSelectOptionTone(tone))
          .map(String);
  if (invalid.length > 0) {
    throw new Error(
      `${prefix} column "${column.field}" has enumOption tones ${invalid.join(", ")} — ` +
        `expected one of ${SELECT_OPTION_TONES.join(", ")}.`,
    );
  }
}

// Shared entity-target resolution for reference facets, refEntity columns
// (projectionList/relatedList) and refEntity fields (projectionDetail).
export function assertRefTargetRegistered(
  prefix: string,
  subject: string,
  refTarget: string,
  currentFeatureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const target = parseRefTarget(refTarget, currentFeatureName);
  const targetFeature = featureMap.get(target.featureName);
  if (targetFeature === undefined) {
    throw new Error(
      `${prefix} ${subject} targets entity "${refTarget}", but feature "${target.featureName}" is not ` +
        `mounted — mount it and declare r.requires({ features: ["${target.featureName}"] }).`,
    );
  }
  if (targetFeature.entities?.[target.entityName] === undefined) {
    throw new Error(
      `${prefix} ${subject} targets entity "${refTarget}", which does not resolve to a ` +
        `registered entity. Known entities in feature "${target.featureName}": ` +
        `${
          Object.keys(targetFeature.entities ?? {})
            .sort()
            .join(", ") || "(none)"
        }.`,
    );
  }
}

// Facets — unlike filter, a field inventory IS available here: the
// declared columns. A facet on a field with no column is almost always a
// typo (the user never sees the field anywhere), so this is hard-checked
// rather than just documented. Shared by projectionList and relatedList —
// `prefix` carries the caller's own screen/section message lead-in.
//
// `type: "reference"` is exempt from the same-name-column rule: it filters
// by an id field (e.g. "propertyId") but displays a different,
// human-readable column (e.g. "propertyLabel") — a column named after the
// filter field would almost never exist, and requiring one anyway would
// force apps to add a column no design calls for just to satisfy this check.
// Its own `entity` is mandatory on the type (TS, not just this validator) and
// is resolved below — that explicit, checked declaration is this facet type's
// field inventory, filling the same "not just a typo" role the column-name
// check plays for select/boolean facets. select/boolean facets keep the
// column requirement unchanged: both filter and display the same field, so a
// facet with no matching column is still almost always a typo.
export function validateListFacets(
  prefix: string,
  facets: readonly ListFacetSpec[],
  columns: readonly ListColumnSpec[],
  currentFeatureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const columnFieldNames = new Set(columns.map((col) => normalizeListColumn(col).field));
  const seenFacetFields = new Set<string>();
  for (const facet of facets) {
    if (seenFacetFields.has(facet.field)) {
      throw new Error(
        `${prefix} declares facet "${facet.field}" more than once. Declare each facet field once.`,
      );
    }
    seenFacetFields.add(facet.field);
    if (facet.type !== "reference" && !columnFieldNames.has(facet.field)) {
      throw new Error(
        `${prefix} facet references field "${facet.field}" which is not a declared column. ` +
          `Known columns: ${[...columnFieldNames].sort().join(", ")}`,
      );
    }
    if (facet.type === "select" && facet.options.length === 0) {
      throw new Error(
        `${prefix} facet "${facet.field}" (type "select") has an empty options list — ` +
          `declare at least one option.`,
      );
    }
    if (facet.type === "reference") {
      assertRefTargetRegistered(
        prefix,
        `facet "${facet.field}" (type "reference")`,
        facet.entity,
        currentFeatureName,
        featureMap,
      );
      assertReferenceListHandlerRegistered(
        prefix,
        `facet "${facet.field}" (type "reference")`,
        facet.entity,
        currentFeatureName,
        featureMap,
      );
    }
  }
}

// The facet's options are loaded at render time by dispatching the target's
// list query (renderer useReferenceLookup, incl. its REFERENCE_LOOKUP_SOURCES
// override); a missing or unregistered handler is swallowed there and leaves
// a permanently empty dropdown, so it has to fail at boot instead.
function assertReferenceListHandlerRegistered(
  prefix: string,
  subject: string,
  refTarget: string,
  currentFeatureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const target = parseRefTarget(refTarget, currentFeatureName);
  const override = REFERENCE_LOOKUP_SOURCES[`${target.featureName}:${target.entityName}`];
  const expectedQn =
    override?.queryQn ??
    qualifyEntityName(target.featureName, "query", `${target.entityName}:list`);
  for (const feature of featureMap.values()) {
    for (const handlerName of Object.keys(feature.queryHandlers ?? {})) {
      // skip: expected list handler found
      if (qualifyEntityName(feature.name, "query", handlerName) === expectedQn) return;
    }
  }
  throw new Error(
    `${prefix} ${subject} loads its options from query "${expectedQn}", which is not a registered ` +
      `query handler — register the entity's list handler (defineEntityListHandler) or the facet renders an empty dropdown.`,
  );
}
