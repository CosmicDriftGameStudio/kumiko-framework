import { qualifyEntityName } from "../qualified-name.ts";
import { isFieldsEditSection, normalizeEditField, sectionFieldSpecs } from "../screen-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";
import type {
  EditRelatedListSection,
  MetricNavigate,
  ProjectionDetailScreenDefinition,
  RowFieldExtractor,
  ScreenDefinition,
} from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import {
  collectScreensByShortId,
  readsNavigateParamsAsFormPrefill,
  rowFieldExtractorKeys,
  validateDrawerPrefillKeys,
} from "./screens.ts";
import { SCREEN_RULES } from "./screens-rules.ts";

type NavigateParamsSource = {
  readonly screen?: string;
  readonly entity?: string;
  readonly entityId?: string;
  readonly params: RowFieldExtractor;
  readonly sourceScreenEntity: string | undefined;
  readonly sourceLabel: string;
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
   *  (RelatedListSection's `navigatePrefill`, related-list-section.tsx).
   *  The parent id arrives via the URL, so it is attacker-controllable: write
   *  handlers must validate parent references server-side (tenant-scoped
   *  lookup), never trust the prefilled value. */
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
function subtitlePartNavigates(screen: ProjectionDetailScreenDefinition): MetricNavigate[] {
  const subtitle = screen.header?.subtitle;
  if (typeof subtitle === "string" || subtitle === undefined) return [];
  return subtitle.flatMap((part) =>
    typeof part === "string" || part.navigate === undefined ? [] : [part.navigate],
  );
}
function projectionDetailNavigateActions(
  screen: ProjectionDetailScreenDefinition,
): ScopedNavigateAction[] {
  return [
    ...scopeActions(screen.actions, screen.detailFor),
    ...screen.layout.sections.flatMap((section) =>
      section.kind !== "relatedList"
        ? []
        : [
            ...scopeActions(section.rowActions, undefined),
            ...scopeActions(section.toolbarActions, undefined, {
              pick: [relatedListParentParamField(section)],
            }),
          ],
    ),
    ...(screen.metrics ?? []).flatMap((metric) =>
      metric.navigate === undefined ? [] : scopeActions([metric.navigate], undefined),
    ),
    ...subtitlePartNavigates(screen).flatMap((navigate) => scopeActions([navigate], undefined)),
  ];
}
function navigateActionsOf(screen: ScreenDefinition): ScopedNavigateAction[] {
  switch (screen.type) {
    case "entityList":
      return [
        ...scopeActions(screen.rowActions, screen.entity),
        ...(screen.expandableRow === undefined
          ? []
          : [
              ...scopeActions(screen.expandableRow.rowActions, undefined),
              ...scopeActions(screen.expandableRow.toolbarActions, undefined, {
                pick: [relatedListParentParamField(screen.expandableRow)],
              }),
            ]),
      ];
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
  sourceLabel: string,
): NavigateParamsSource {
  return {
    ...(action.screen !== undefined && { screen: action.screen }),
    ...(action.entity !== undefined && { entity: action.entity }),
    ...(action.entityId !== undefined && { entityId: action.entityId }),
    params,
    sourceScreenEntity,
    sourceLabel,
  };
}

// Every declarative navigate that writes params into the target's URL —
// the same sources validateScreens pairs with validateRowActionNavigateParams,
// plus projectionDetail metrics (runMetricNavigate), which reuse that shape —
// plus a relatedList toolbarAction with no `params` of its own, which still
// writes its implicit parent-id param at runtime (see `implicitParams`).
function navigateParamsSources(
  screen: ScreenDefinition,
  sourceLabel: string,
): NavigateParamsSource[] {
  return navigateActionsOf(screen).flatMap(({ action, sourceScreenEntity, implicitParams }) => {
    if (!isNavigateKind(action)) return [];
    const params = action.params ?? implicitParams;
    return params === undefined
      ? []
      : [toNavigateParamsSource(action, params, sourceScreenEntity, sourceLabel)];
  });
}

// Per target screen QN, every navigate `params` source that writes into the
// target's URL prefill. A form screen absent from the map accepts no URL prefill.
function collectUrlPrefillSourcesByScreenQn(
  features: readonly FeatureDefinition[],
): Map<string, NavigateParamsSource[]> {
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

  const result = new Map<string, NavigateParamsSource[]>();
  for (const feature of features) {
    for (const [screenId, screen] of Object.entries(feature.screens)) {
      const sourceLabel = `[Feature ${feature.name}] Screen "${screenId}" (${screen.type}) navigate action`;
      for (const source of navigateParamsSources(screen, sourceLabel)) {
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
        result.set(qn, [...(result.get(qn) ?? []), source]);
      }
    }
  }
  return result;
}

// Per target screen QN, the union of field names any navigate `params` may
// prefill from the URL.
export function collectUrlPrefillFieldsByScreenQn(
  features: readonly FeatureDefinition[],
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const [qn, sources] of collectUrlPrefillSourcesByScreenQn(features)) {
    result.set(qn, new Set(sources.flatMap((source) => rowFieldExtractorKeys(source.params))));
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

function assertHiddenRequiredFieldsSeeded(
  featureName: string,
  screenId: string,
  screen: Extract<ScreenDefinition, { type: "actionForm" | "secretMint" }>,
  seeded: ReadonlySet<string>,
): void {
  for (const section of screen.layout.sections) {
    if (!isFieldsEditSection(section)) continue;
    for (const rawSpec of sectionFieldSpecs(section)) {
      const spec = normalizeEditField(rawSpec);
      if (spec.visible !== false) continue;
      const fieldDef = screen.fields[spec.field];
      if (fieldDef === undefined || !("required" in fieldDef) || fieldDef.required !== true) {
        continue;
      }
      if (seeded.has(spec.field)) continue;
      throw bootRuleError(SCREEN_RULES.submitPrefilledHiddenRequired, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (${screen.type}) sets submitPrefilled but ` +
          `hides required field "${spec.field}" (visible: false) and no navigate action passes it in ` +
          `params — the field could never get a value and the form could never submit. Add ` +
          `"${spec.field}" to the params of a navigate action targeting this screen, make the field ` +
          `visible, or drop required.`,
      });
    }
  }
}

// submitPrefilled lets an unchanged form submit, so a required field the layout
// hides must be seeded by a navigate param — nothing else can ever fill it. The
// param keys of every source (incl. metric/subtitle navigates and the implicit
// relatedList parent id) must also be fields the renderer would actually prefill.
export function validateSubmitPrefilledHiddenFields(features: readonly FeatureDefinition[]): void {
  const sourcesByScreenQn = collectUrlPrefillSourcesByScreenQn(features);
  for (const feature of features) {
    for (const [screenId, screen] of Object.entries(feature.screens)) {
      if (screen.type !== "actionForm" && screen.type !== "secretMint") continue;
      if (screen.submitPrefilled !== true) continue;
      const sources = sourcesByScreenQn.get(qualifyEntityName(feature.name, "screen", screenId));
      for (const source of sources ?? []) {
        validateDrawerPrefillKeys(
          source.sourceLabel,
          "navigate-target",
          screenId,
          screen,
          source.params,
        );
      }
      const seeded = new Set(
        (sources ?? []).flatMap((source) => rowFieldExtractorKeys(source.params)),
      );
      // A `load` form is seeded from the loaded record, not from navigate params.
      if (screen.type === "actionForm" && screen.load !== undefined) continue;
      assertHiddenRequiredFieldsSeeded(feature.name, screenId, screen, seeded);
    }
  }
}
