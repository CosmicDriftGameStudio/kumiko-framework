import { qualifyEntityName } from "../qualified-name";
import type { FeatureDefinition } from "../types";
import type { RowFieldExtractor, ScreenDefinition } from "../types/screen";
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

// Every declarative navigate that writes `params` into the target's URL —
// the same sources validateScreens pairs with validateRowActionNavigateParams,
// plus projectionDetail metrics (runMetricNavigate), which reuse that shape.
function navigateParamsSources(screen: ScreenDefinition): NavigateParamsSource[] {
  const out: NavigateParamsSource[] = [];
  const push = (
    action: {
      readonly kind?: string;
      readonly screen?: string;
      readonly entity?: string;
      readonly entityId?: string;
      readonly params?: RowFieldExtractor;
    },
    sourceScreenEntity: string | undefined,
  ): void => {
    if (action.kind !== undefined && action.kind !== "navigate") return;
    if (action.params === undefined) return;
    out.push({
      ...(action.screen !== undefined && { screen: action.screen }),
      ...(action.entity !== undefined && { entity: action.entity }),
      ...(action.entityId !== undefined && { entityId: action.entityId }),
      params: action.params,
      sourceScreenEntity,
    });
  };
  switch (screen.type) {
    case "entityList":
      for (const action of screen.rowActions ?? []) push(action, screen.entity);
      break;
    case "projectionList":
      for (const action of screen.rowActions ?? []) push(action, undefined);
      break;
    case "entityEdit":
      for (const action of screen.actions ?? []) push(action, screen.entity);
      break;
    case "projectionDetail":
      for (const action of screen.actions ?? []) push(action, screen.detailFor);
      for (const section of screen.layout.sections) {
        if (section.kind !== "relatedList") continue;
        for (const action of section.rowActions ?? []) push(action, undefined);
      }
      for (const metric of screen.metrics ?? []) {
        if (typeof metric === "string" || metric.navigate === undefined) continue;
        push(metric.navigate, undefined);
      }
      break;
    default:
      break;
  }
  return out;
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
