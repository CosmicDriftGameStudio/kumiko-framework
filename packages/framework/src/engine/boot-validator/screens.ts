import { bootRuleError } from "./boot-rule.ts";
import { SCREEN_RULES } from "./screens-rules.ts";
// Screen validation entry point. The per-kind validators live in the
// screens-kind-*.ts siblings and the shared sub-validators in screens-dashboard/
// forms/lists/actions; dependencies only point one way (screens.ts ->
// screens-kind-*.ts -> screens-kind-shared.ts -> dashboard/forms/lists -> actions),
// so there is no same-folder require cycle.

import type { ConfigKeyDefinition } from "@cosmicdrift/kumiko-types/config";
import { qualifyEntityName } from "../qualified-name.ts";
import type { ScreenKind, ScreenOfKind } from "../screen-kind.ts";
import type { FeatureDefinition } from "../types/index.ts";

import type {
  ActionFormScreenDefinition,
  CustomScreenDefinition,
  DashboardScreenDefinition,
  ScreenDefinition,
} from "../types/screen.ts";
import type { NavigateTargetLookups } from "./screens-actions.ts";
import { validateActionHasIcon, validateScreenVisibleWhen } from "./screens-actions.ts";
import {
  validateDashboardActions,
  validateDashboardRecordBinding,
  validateDashboardScreen,
} from "./screens-dashboard.ts";
import { validateInlineFormScreen } from "./screens-forms.ts";
import { validateConfigEditScreen } from "./screens-kind-config-edit.ts";
import { validateEntityEditScreen } from "./screens-kind-entity-edit.ts";
import { validateEntityListScreen } from "./screens-kind-entity-list.ts";
import { validateProjectionDetailScreen } from "./screens-kind-projection-detail.ts";
import { validateProjectionListScreen } from "./screens-kind-projection-list.ts";
import { validateSecretMintScreen } from "./screens-kind-secret-mint.ts";
import { listActionContext, type ScreenValidationContext } from "./screens-kind-shared.ts";
import {
  validateExplicitListScreenExists,
  validateListActionTargets,
  validateScreenHasNavArea,
} from "./screens-lists.ts";

export {
  readsNavigateParamsAsFormPrefill,
  resolveScreenTargetQn,
  rowFieldExtractorKeys,
  validateActionFieldRefs,
  validateActionHasIcon,
  validateDrawerPrefillKeys,
  validateScreenShortIdCollisions,
} from "./screens-actions.ts";
export { validateDashboardCustomPanel, validateDashboardScreenPanel } from "./screens-dashboard.ts";
export { validateColumnRendererForm } from "./screens-lists.ts";

type ScreenKindValidators = {
  readonly [K in ScreenKind]: (
    ctx: ScreenValidationContext,
    screenId: string,
    screen: ScreenOfKind[K],
  ) => void;
};

function validateCustomScreen(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: CustomScreenDefinition,
): void {
  if (!screen.renderer.react && !screen.renderer.native) {
    throw bootRuleError(SCREEN_RULES.customNoComponent, {
      message:
        `[Feature ${ctx.feature.name}] Screen "${screenId}" has type="custom" but the renderer ` +
        `declares neither a react nor a native component — at least one platform must be set.`,
    });
  }
}

function validateDashboardKindScreen(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: DashboardScreenDefinition,
): void {
  validateDashboardScreen(ctx.feature.name, screenId, screen, ctx.featureMap);
  validateDashboardRecordBinding(ctx.feature.name, screenId, screen);
  validateDashboardActions(ctx.feature.name, screenId, screen, ctx.allWriteHandlerQns, ctx);
}

function validateActionFormScreen(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ActionFormScreenDefinition,
): void {
  validateInlineFormScreen(
    ctx.feature,
    screenId,
    screen,
    "actionForm",
    ctx.allWriteHandlerQns,
    ctx,
    ctx.featureMap,
  );
}

const SCREEN_KIND_VALIDATORS: ScreenKindValidators = {
  custom: validateCustomScreen,
  projectionList: validateProjectionListScreen,
  projectionDetail: validateProjectionDetailScreen,
  dashboard: validateDashboardKindScreen,
  configEdit: validateConfigEditScreen,
  actionForm: validateActionFormScreen,
  secretMint: validateSecretMintScreen,
  // secretsEdit is generator-only (buildConfigFeatureSchema) — never authored
  // via r.screen, so feature.screens never actually carries one.
  secretsEdit: () => {},
  entityList: validateEntityListScreen,
  entityEdit: validateEntityEditScreen,
};

function validateScreenOfKind<K extends ScreenKind>(
  ctx: ScreenValidationContext,
  screenId: string,
  kind: K,
  screen: ScreenOfKind[K],
): void {
  SCREEN_KIND_VALIDATORS[kind](ctx, screenId, screen);
}

// Only reachable by casting past ScreenDefinition; without this the table
// lookup would surface as a TypeError instead of a boot error.
function rejectUnknownScreenKind(
  featureName: string,
  screenId: string,
  screen: ScreenDefinition,
): void {
  if (!Object.hasOwn(SCREEN_KIND_VALIDATORS, screen.type)) {
    throw bootRuleError(SCREEN_RULES.unknownType, {
      message: `[Feature ${featureName}] Screen "${screenId}" has unknown type "${String(screen.type)}".`,
    });
  }
}

function buildScreenValidationContext(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  allWriteHandlerQns: ReadonlySet<string>,
  allScreenQns: ReadonlySet<string>,
  configKeyDefsByQn: ReadonlyMap<string, ConfigKeyDefinition>,
  screensByShortId: NavigateTargetLookups["screensByShortId"],
  detailForScreens: NavigateTargetLookups["detailForScreens"],
): ScreenValidationContext {
  // navigate targets (rowAction/toolbarAction) may point cross-feature: the
  // runtime router (create-app) resolves a bare screenId app-wide across ALL
  // features (a declarative list in the entity's owning feature navigates to
  // the consumer app's custom editors this way). The validator mirrors that:
  // same feature OR any feature. redirect/cancelTarget additionally accept a
  // fully qualified cross-feature QN (resolveScreenTargetQn); short IDs
  // stay same-feature as before.
  const navTargetShortIds = screenShortIdsFrom(allScreenQns);
  return {
    feature,
    featureMap,
    allWriteHandlerQns,
    configKeyDefsByQn,
    allScreenQns,
    navTargetShortIds,
    screensByShortId,
    detailForScreens,
  };
}

function validateListEmptyStateAction(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ScreenDefinition,
): void {
  if (
    (screen.type === "entityList" || screen.type === "projectionList") &&
    screen.emptyState?.action !== undefined
  ) {
    validateActionHasIcon(
      ctx.feature.name,
      screenId,
      screen.type,
      "emptyState action",
      screen.emptyState.action,
    );
    validateListActionTargets(
      listActionContext(
        ctx,
        screenId,
        screen.type,
        undefined,
        `Screen "${screenId}" (${screen.type})`,
      ),
      "emptyState action",
      screen.emptyState.action,
    );
  }
}

// Output of buildAppSchema, which overwrites it — an authored value would be a silent no-op.
function rejectAuthoredUrlPrefillFields(
  featureName: string,
  screenId: string,
  screen: ScreenDefinition,
): void {
  if (
    (screen.type === "entityEdit" ||
      screen.type === "actionForm" ||
      screen.type === "secretMint") &&
    screen.urlPrefillFields !== undefined
  ) {
    throw bootRuleError(SCREEN_RULES.urlPrefillFieldsSet, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (${screen.type}) sets urlPrefillFields — ` +
        `it is derived from navigate params by buildAppSchema; declare params on the navigating action instead.`,
    });
  }
}

function rejectSubmitPrefilledOutsideForms(
  featureName: string,
  screenId: string,
  screen: ScreenDefinition,
): void {
  if (
    screen.type !== "actionForm" &&
    screen.type !== "secretMint" &&
    "submitPrefilled" in screen &&
    screen.submitPrefilled !== undefined
  ) {
    throw bootRuleError(SCREEN_RULES.submitPrefilledUnsupported, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (${screen.type}) sets submitPrefilled — ` +
        `only actionForm and secretMint screens support it. Remove it.`,
    });
  }
}

function validateScreenPrelude(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ScreenDefinition,
): void {
  const featureName = ctx.feature.name;
  validateExplicitListScreenExists(featureName, screenId, screen, ctx.screensByShortId);
  validateListEmptyStateAction(ctx, screenId, screen);
  rejectAuthoredUrlPrefillFields(featureName, screenId, screen);
  rejectSubmitPrefilledOutsideForms(featureName, screenId, screen);
  validateScreenHasNavArea(ctx.feature, screenId, screen, ctx.featureMap);
  validateScreenVisibleWhen(ctx.feature, screenId, screen, ctx.allScreenQns, ctx.featureMap);
}

export function validateScreens(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  allWriteHandlerQns: ReadonlySet<string>,
  allScreenQns: ReadonlySet<string>,
  configKeyDefsByQn: ReadonlyMap<string, ConfigKeyDefinition>,
  screensByShortId: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly featureName: string; readonly screen: ScreenDefinition }>
  >,
  detailForScreens: ReadonlyMap<
    string,
    { readonly featureName: string; readonly screen: ScreenDefinition }
  >,
): void {
  const ctx = buildScreenValidationContext(
    feature,
    featureMap,
    allWriteHandlerQns,
    allScreenQns,
    configKeyDefsByQn,
    screensByShortId,
    detailForScreens,
  );
  for (const [screenId, screen] of Object.entries(feature.screens)) {
    validateScreenPrelude(ctx, screenId, screen);
    rejectUnknownScreenKind(feature.name, screenId, screen);
    validateScreenOfKind(ctx, screenId, screen.type, screen);
  }
}

export function collectScreenQns(features: readonly FeatureDefinition[]): Set<string> {
  const set = new Set<string>();
  for (const f of features) {
    for (const screenId of Object.keys(f.screens)) {
      set.add(qualifyEntityName(f.name, "screen", screenId));
    }
  }
  return set;
}

// Extract bare screen IDs (without the `<feature>:screen:` prefix) from
// qualified QNs for app-wide navigate-target resolution (see buildScreenValidationContext).
// This mirrors the runtime router, which matches bare IDs across features.
export function screenShortIdsFrom(allScreenQns: ReadonlySet<string>): Set<string> {
  const marker = ":screen:";
  const set = new Set<string>();
  for (const qn of allScreenQns) {
    const at = qn.indexOf(marker);
    if (at !== -1) set.add(qn.slice(at + marker.length));
  }
  return set;
}

// Short screen-id → every {featureName, screen} that registers it. The
// runtime router (create-app.tsx) resolves a bare navigate-target short-id by
// scanning ALL features and taking the first match — so two features
// registering the same short-id is a silent routing footgun (whichever
// feature comes first in the app's features[] array always wins, the other
// is unreachable by that id) and a prerequisite for the entityId-check below
// (which target screen it resolves to must be unambiguous).
export function collectScreensByShortId(
  features: readonly FeatureDefinition[],
): Map<string, ReadonlyArray<{ readonly featureName: string; readonly screen: ScreenDefinition }>> {
  const map = new Map<
    string,
    Array<{ readonly featureName: string; readonly screen: ScreenDefinition }>
  >();
  for (const f of features) {
    for (const [screenId, screen] of Object.entries(f.screens)) {
      const entries = map.get(screenId) ?? [];
      entries.push({ featureName: f.name, screen });
      map.set(screenId, entries);
    }
  }
  return map;
}
