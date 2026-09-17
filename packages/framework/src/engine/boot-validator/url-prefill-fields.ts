import { qualifyEntityName } from "../qualified-name";
import type { FeatureDefinition } from "../types";
import type {
  EditRelatedListSection,
  ProjectionDetailScreenDefinition,
  RowFieldExtractor,
  ScreenDefinition,
} from "../types/screen";
import {
  collectScreensByShortId,
  readsNavigateParamsAsFormPrefill,
  rowFieldExtractorKeys,
} from "./screens";

type NavigateParamsSource = {
  readonly screen?: string;
  readonly entity?: string;
  readonly entityId?: string;
  readonly params: RowFieldExtractor;
  readonly sourceScreenEntity: string | undefined;
};

type NavigateActionLike = {
  readonly kind?: string;
  readonly screen?: string;
  readonly entity?: string;
  readonly entityId?: string;
  readonly params?: RowFieldExtractor;
};
type ScopedNavigateAction = {
  readonly action: NavigateActionLike;
  readonly sourceScreenEntity: string | undefined;
  /** Used when the action itself declares no `params` — the field a
   *  relatedList toolbarAction's parent id lands under at runtime
   *  (RelatedListSection's `navigatePrefill`, related-list-section.tsx). */
  readonly implicitParams?: RowFieldExtractor;
};

function isNavigateKind(action: NavigateActionLike): boolean {
  return action.kind === undefined || action.kind === "navigate";
}
function scopeActions(
  actions: readonly NavigateActionLike[] | undefined,
  sourceScreenEntity: string | undefined,
  implicitParams?: RowFieldExtractor,
): ScopedNavigateAction[] {
  return (actions ?? []).map((action) => ({ action, sourceScreenEntity, implicitParams }));
}
// Same key the renderer falls back to when a relatedList toolbarAction has no
// `params` of its own: `parentFilter.field`, else `parentParam`, else "id".
function relatedListParentParamField(section: EditRelatedListSection): string {
  return section.parentFilter?.field ?? section.parentParam ?? "id";
}
function projectionDetailNavigateActions(
  screen: ProjectionDetailScreenDefinition,
): ScopedNavigateAction[] {
  return [
    ...scopeActions(screen.actions, screen.detailFor),
    ...screen.layout.sections.flatMap((section) =>
      section.kind === "relatedList" ? scopeActions(section.rowActions, undefined) : [],
    ),
    ...screen.layout.sections.flatMap((section) =>
      section.kind === "relatedList"
        ? scopeActions(section.toolbarActions, undefined, {
            pick: [relatedListParentParamField(section)],
          })
        : [],
    ),
    ...(screen.metrics ?? []).flatMap((metric) =>
      typeof metric === "string" || metric.navigate === undefined
        ? []
        : scopeActions([metric.navigate], undefined),
    ),
  ];
}
function navigateActionsOf(screen: ScreenDefinition): ScopedNavigateAction[] {
  switch (screen.type) {
    case "entityList":
      return scopeActions(screen.rowActions, screen.entity);
    case "projectionList":
      return scopeActions(screen.rowActions, undefined);
    case "entityEdit":
      return scopeActions(screen.actions, screen.entity);
    case "projectionDetail":
      return projectionDetailNavigateActions(screen);
    default:
      return [];
  }
}
function toNavigateParamsSource(
  action: NavigateActionLike,
  params: RowFieldExtractor,
  sourceScreenEntity: string | undefined,
): NavigateParamsSource {
  return {
    ...(action.screen !== undefined && { screen: action.screen }),
    ...(action.entity !== undefined && { entity: action.entity }),
    ...(action.entityId !== undefined && { entityId: action.entityId }),
    params,
    sourceScreenEntity,
  };
}

// Every declarative navigate that writes params into the target's URL —
// the same sources validateScreens pairs with validateRowActionNavigateParams,
// plus projectionDetail metrics (runMetricNavigate), which reuse that shape —
// plus a relatedList toolbarAction with no `params` of its own, which still
// writes its implicit parent-id param at runtime (see `implicitParams`).
function navigateParamsSources(screen: ScreenDefinition): NavigateParamsSource[] {
  return navigateActionsOf(screen).flatMap(({ action, sourceScreenEntity, implicitParams }) => {
    if (!isNavigateKind(action)) return [];
    const params = action.params ?? implicitParams;
    return params === undefined ? [] : [toNavigateParamsSource(action, params, sourceScreenEntity)];
  });
}

// Per target screen QN, the union of field names any navigate `params` may
// prefill from the URL. A form screen absent from the map accepts no URL prefill.
export function collectUrlPrefillFieldsByScreenQn(
  features: readonly FeatureDefinition[],
): Map<string, Set<string>> {
  const screensByShortId = collectScreensByShortId(features);
  const detailForByEntity = new Map<
    string,
    { readonly featureName: string; readonly shortId: string; readonly screen: ScreenDefinition }
  >();
  for (const feature of features) {
    for (const [shortId, screen] of Object.entries(feature.screens)) {
      if (screen.detailFor !== undefined && !detailForByEntity.has(screen.detailFor)) {
        detailForByEntity.set(screen.detailFor, { featureName: feature.name, shortId, screen });
      }
    }
  }

  const result = new Map<string, Set<string>>();
  for (const feature of features) {
    for (const screen of Object.values(feature.screens)) {
      for (const source of navigateParamsSources(screen)) {
        const target = resolveTarget(source, screensByShortId, detailForByEntity);
        if (target === undefined) continue;
        const explicitEntityId =
          source.entity !== undefined ? (source.entityId ?? "id") : source.entityId;
        if (
          !readsNavigateParamsAsFormPrefill(
            target.screen,
            explicitEntityId,
            source.sourceScreenEntity,
          )
        ) {
          continue;
        }
        const qn = qualifyEntityName(target.featureName, "screen", target.shortId);
        const fields = result.get(qn) ?? new Set<string>();
        for (const key of rowFieldExtractorKeys(source.params)) fields.add(key);
        result.set(qn, fields);
      }
    }
  }
  return result;
}

// Runtime resolution: a bare screen id matches the first feature registering
// it (create-app's router); an entity target opens its detailFor screen with an id.
function resolveTarget(
  source: NavigateParamsSource,
  screensByShortId: ReturnType<typeof collectScreensByShortId>,
  detailForByEntity: ReadonlyMap<
    string,
    { readonly featureName: string; readonly shortId: string; readonly screen: ScreenDefinition }
  >,
):
  | { readonly featureName: string; readonly shortId: string; readonly screen: ScreenDefinition }
  | undefined {
  if (source.entity !== undefined) return detailForByEntity.get(source.entity);
  if (source.screen === undefined) return undefined;
  const match = screensByShortId.get(source.screen)?.[0];
  return match === undefined ? undefined : { ...match, shortId: source.screen };
}
