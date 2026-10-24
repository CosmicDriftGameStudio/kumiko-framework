// Checks shared by several screen kinds; each helper takes the kind it reports under.
// Dependencies point one way: screens-kind-*.ts -> here ->
// screens-dashboard/forms/lists -> screens-actions.

import type { ConfigKeyDefinition } from "@cosmicdrift/kumiko-types/config";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { qualifyEntityName } from "../qualified-name.ts";
import { isWriteFormEditSection, type normalizeListColumn } from "../screen-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";

import type {
  EditExtensionSection,
  EditFieldsSection,
  EditSectionSpec,
  RowAction,
} from "../types/screen.ts";
import type { NavigateSourceScreenType, NavigateTargetLookups } from "./screens-actions.ts";
import {
  isRowClickAction,
  type resolveRowActionNavigateTarget,
  validateActionHasIcon,
  validateNavigateActionTab,
  validateRecordActionRedirect,
} from "./screens-actions.ts";
import type { ListActionTargetContext } from "./screens-lists.ts";
import {
  assertRefTargetRegistered,
  rejectInertColumnSortable,
  validateColumnRendererForm,
  validateRowActionTarget,
} from "./screens-lists.ts";

export type ScreenValidationContext = NavigateTargetLookups & {
  readonly feature: FeatureDefinition;
  readonly featureMap: ReadonlyMap<string, FeatureDefinition>;
  readonly allWriteHandlerQns: ReadonlySet<string>;
  readonly configKeyDefsByQn: ReadonlyMap<string, ConfigKeyDefinition>;
};

export function findEntityFeature(
  entityName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): string | undefined {
  for (const [name, feature] of featureMap) {
    if (feature.entities?.[entityName]) return name;
  }
  return undefined;
}

export function buildUnknownFieldMessage(
  featureName: string,
  screenId: string,
  fieldName: string,
  entityName: string,
  knownFields: ReadonlySet<string>,
): string {
  const known = [...knownFields].sort().join(", ");
  return (
    `[Feature ${featureName}] Screen "${screenId}" references field "${fieldName}" ` +
    `which does not exist on entity "${entityName}" (known: ${known}).`
  );
}

export function listActionContext(
  ctx: ScreenValidationContext,
  screenId: string,
  screenType: NavigateSourceScreenType,
  screenEntity: string | undefined,
  where: string,
): ListActionTargetContext {
  return {
    featureName: ctx.feature.name,
    screenId,
    screenType,
    screenEntity,
    where,
    screens: ctx.feature.screens,
    allWriteHandlerQns: ctx.allWriteHandlerQns,
    allScreenQns: ctx.allScreenQns,
    navTargetShortIds: ctx.navTargetShortIds,
    screensByShortId: ctx.screensByShortId,
    detailForScreens: ctx.detailForScreens,
  };
}

// entityList / entityEdit: entity-refs are feature-local.
export function resolveScreenEntity(
  ctx: ScreenValidationContext,
  screenId: string,
  entityName: string,
): EntityDefinition {
  const entityDef = ctx.feature.entities?.[entityName];
  if (entityDef) return entityDef;
  const known =
    Object.keys(ctx.feature.entities ?? {})
      .sort()
      .join(", ") || "(none)";
  const crossFeature = findEntityFeature(entityName, ctx.featureMap);
  const hint = crossFeature
    ? ` Entity "${entityName}" is owned by feature "${crossFeature}" — cross-feature screen ownership is not supported.`
    : "";
  throw new Error(
    `[Feature ${ctx.feature.name}] Screen "${screenId}" references entity "${entityName}" ` +
      `which is not declared in this feature (known: ${known}).${hint}`,
  );
}

export function rejectMissingQuery(
  featureName: string,
  screenId: string,
  kind: "projectionList" | "projectionDetail",
  query: unknown,
): void {
  if (!query || typeof query !== "string") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${kind}) has empty or non-string query. Set query to a registered query name.`,
    );
  }
}

// An empty column list would render a blank table: almost always an
// in-progress screen the author forgot to fill in.
export function rejectEmptyColumns(
  featureName: string,
  screenId: string,
  kind: "projectionList" | "entityList",
  columnCount: number,
): void {
  if (columnCount === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${kind}) has an empty columns list — ` +
        `declare at least one column.`,
    );
  }
}

export function validateListColumnRendering(
  ctx: ScreenValidationContext,
  screenId: string,
  kind: "projectionList" | "entityList",
  column: ReturnType<typeof normalizeListColumn>,
): void {
  const featureName = ctx.feature.name;
  validateColumnRendererForm(featureName, screenId, column);
  rejectInertColumnSortable(featureName, screenId, kind, column);
  if (column.refEntity !== undefined) {
    assertRefTargetRegistered(
      `[Feature ${featureName}] Screen "${screenId}" (${kind})`,
      `column "${column.field}" (refEntity)`,
      column.refEntity,
      featureName,
      ctx.featureMap,
    );
  }
}

export function rejectNonArrayInFilter(
  featureName: string,
  screenId: string,
  kind: "projectionList" | "entityList",
  filter: { readonly op: string; readonly value?: unknown },
): void {
  if (filter.op === "in" && !Array.isArray(filter.value)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${kind}) filter.op "in" requires ` +
        `filter.value to be a readonly array. Pass an array as filter.value.`,
    );
  }
}

// A layout with zero sections renders as nothing: reject at boot so the
// author sees it before the blank form surprises them.
export function rejectEmptySections(
  featureName: string,
  screenId: string,
  kind: "projectionDetail" | "configEdit" | "entityEdit",
  sectionCount: number,
): void {
  if (sectionCount === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${kind}) has an empty sections list — ` +
        `declare at least one section.`,
    );
  }
}

export function assertExtensionSectionHasComponent(
  featureName: string,
  screenId: string,
  kind: "projectionDetail" | "configEdit" | "entityEdit",
  section: EditExtensionSection,
): void {
  if (section.component?.react === undefined && section.component?.native === undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${kind}) extension section ` +
        `"${section.title}" has no component — declare a react/native component marker.`,
    );
  }
}

// relatedList and writeForm sections exist on projectionDetail only; what
// remains afterwards is a plain fields/groups section.
export function rejectProjectionDetailOnlySection(
  featureName: string,
  screenId: string,
  kind: "configEdit" | "entityEdit",
  section: Exclude<EditSectionSpec, EditExtensionSection>,
): asserts section is EditFieldsSection {
  if (section.kind === "relatedList") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${kind}) relatedList section ` +
        `"${section.title}" is not supported — relatedList is a projectionDetail-only ` +
        `primitive (fw#2166). Move the section to a projectionDetail screen or remove it.`,
    );
  }
  if (isWriteFormEditSection(section)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${kind}) writeForm section ` +
        `"${section.title}" is not supported — writeForm is a projectionDetail-only primitive. Move the section to a projectionDetail screen or remove it.`,
    );
  }
}

export function editSectionLabel(section: EditSectionSpec): string {
  return section.title ?? section.id ?? "(untitled)";
}

export function validateRecordSectionActions(
  ctx: ScreenValidationContext,
  screenId: string,
  kind: "projectionDetail" | "entityEdit",
  section: EditSectionSpec,
): void {
  const actionContext = `section "${editSectionLabel(section)}" action`;
  for (const action of section.actions ?? []) {
    validateActionHasIcon(ctx.feature.name, screenId, kind, actionContext, action);
    validateRecordActionRedirect(ctx.feature, screenId, kind, action, ctx);
    validateNavigateActionTab(ctx.feature.name, screenId, kind, actionContext, action, ctx);
  }
}

const NO_ROW_SUBJECT: Record<"projectionDetail" | "entityEdit", string> = {
  projectionDetail: "a detail screen",
  entityEdit: "an edit screen",
};

// Header actions reuse RowAction (the displayed record stands in for the row),
// so the same navigate/writeHandler existence checks as list rowActions apply.
// `rowClick` is rejected outright: there is no row to click.
export function validateRecordHeaderAction(
  ctx: ScreenValidationContext,
  screenId: string,
  kind: "projectionDetail" | "entityEdit",
  screenEntity: string | undefined,
  action: RowAction,
): void {
  const featureName = ctx.feature.name;
  validateRecordActionRedirect(ctx.feature, screenId, kind, action, ctx);
  if (isRowClickAction(action)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${qualifyEntityName(featureName, "screen", screenId)}" ` +
        `(${kind}) action "${action.id}" sets rowClick: true — there is no row to ` +
        `click on ${NO_ROW_SUBJECT[kind]}. Remove rowClick.`,
    );
  }
  validateRowActionTarget(
    listActionContext(ctx, screenId, kind, screenEntity, `Screen "${screenId}" (${kind})`),
    "action",
    "rowAction",
    action,
  );
}

type NavigateLink = {
  readonly screen?: string;
  readonly entity?: string;
  readonly entityId?: string;
  readonly tab?: string;
};

export function navigateActionFromLink(
  id: string,
  navigate: NavigateLink,
): Parameters<typeof resolveRowActionNavigateTarget>[4] {
  return {
    kind: "navigate",
    id,
    label: id,
    ...(navigate.screen !== undefined ? { screen: navigate.screen } : {}),
    ...(navigate.entity !== undefined ? { entity: navigate.entity } : {}),
    ...(navigate.entityId !== undefined ? { entityId: navigate.entityId } : {}),
    ...(navigate.tab !== undefined ? { tab: navigate.tab } : {}),
  };
}
