import { DASHBOARD_MIN_REFRESH_SECONDS } from "@cosmicdrift/kumiko-types/screen";
import { normalizeListColumn } from "../screen-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";
import type {
  DashboardChartMarkerKind,
  DashboardChartPanel,
  DashboardChartRanges,
  DashboardChartTone,
  DashboardCustomPanel,
  DashboardFilterDefinition,
  DashboardPanelDefinition,
  DashboardPanelVisibility,
  DashboardRecordBinding,
  DashboardRefresh,
  DashboardScreenDefinition,
  DashboardScreenPanel,
  DashboardStatGroupPanel,
  DashboardTextBlock,
  DashboardTextPanel,
  DashboardTimeRangeDefinition,
  DashboardValueFormat,
  ScreenDefinition,
} from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import {
  assertWriteHandlerRegistered,
  isRowClickAction,
  resolveRowActionNavigateTarget,
  resolveScreenTargetQn,
  validateActionHasIcon,
  validateClientActionName,
  validateRowActionNavigateParams,
} from "./screens-actions.ts";
import { DASHBOARD_CHART_RULES } from "./screens-dashboard-chart-rules.ts";
import { DASHBOARD_RULES } from "./screens-dashboard-rules.ts";
import { assertRefTargetRegistered, validateColumnRendererForm } from "./screens-lists.ts";

// Panel-driven, no entity — structural checks (unique panel ids, non-empty
// queries/columns/valueField); the query contracts (stat record, points
// envelope, paged rows) are resolved at render time.
export function validateDashboardScreen(
  featureName: string,
  screenId: string,
  screen: DashboardScreenDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  if (screen.panels.length === 0) {
    throw bootRuleError(DASHBOARD_RULES.emptyPanels, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (dashboard) has an empty panels list — ` +
        `declare at least one panel.`,
    });
  }
  const panelIds = new Set<string>();
  const addPanelId = (id: string, context: string): void => {
    if (panelIds.has(id)) {
      throw bootRuleError(DASHBOARD_RULES.duplicatePanelId, {
        message: `[Feature ${featureName}] Screen "${screenId}" (dashboard) has duplicate panel id "${id}" (${context}). Give each panel a unique id.`,
      });
    }
    panelIds.add(id);
  };

  for (const panel of screen.panels) {
    addPanelId(panel.id, panel.kind);
    if (panel.kind === "stat-group") {
      validateDashboardStatGroupPanel(featureName, screenId, panel, addPanelId);
    } else if (panel.kind === "custom") {
      validateDashboardCustomPanel(featureName, screenId, panel);
    } else if (panel.kind === "screen") {
      validateDashboardScreenPanel(
        featureName,
        screenId,
        panel,
        featureMap,
        screen.record !== undefined,
      );
    } else if (panel.kind === "text") {
      validateDashboardTextPanel(featureName, screenId, panel, featureMap);
    } else {
      validateDashboardQueryPanel(featureName, screenId, panel, featureMap);
    }
  }

  if (screen.filter !== undefined) {
    validateDashboardFilterDefinition(featureName, screenId, screen.filter);
  }
  if (screen.timeRange !== undefined) {
    validateDashboardTimeRange(featureName, screenId, screen.timeRange, screen.filter?.id);
  }
}

type DashboardActionNavLookups = {
  readonly allScreenQns: Parameters<typeof resolveRowActionNavigateTarget>[5];
  readonly navTargetShortIds: Parameters<typeof resolveRowActionNavigateTarget>[6];
  readonly screensByShortId: Parameters<typeof resolveRowActionNavigateTarget>[7];
  readonly detailForScreens: Parameters<typeof resolveRowActionNavigateTarget>[8];
};

export function validateDashboardActions(
  featureName: string,
  screenId: string,
  screen: DashboardScreenDefinition,
  allWriteHandlerQns: ReadonlySet<string>,
  lookups: DashboardActionNavLookups,
): void {
  const { allScreenQns, navTargetShortIds, screensByShortId, detailForScreens } = lookups;
  // Header actions run on the bound record like projectionDetail's, minus
  // what needs a drawer host or a record screen to leave.
  for (const action of screen.actions ?? []) {
    const where = `[Feature ${featureName}] Screen "${screenId}" (dashboard) action "${action.id}"`;
    validateActionHasIcon(featureName, screenId, "dashboard", "action", action);
    if (isRowClickAction(action)) {
      throw bootRuleError(DASHBOARD_RULES.actionRowClick, {
        message: `${where} sets rowClick: true — a dashboard has no row to click. Remove rowClick.`,
      });
    }
    if (action.kind === "drawer") {
      throw bootRuleError(DASHBOARD_RULES.actionDrawer, {
        message:
          `${where} is a drawer action — a dashboard has no drawer host. Use a navigate, ` +
          `writeHandler or clientAction action.`,
      });
    }
    if (action.kind === "navigate") {
      const target = resolveRowActionNavigateTarget(
        featureName,
        screenId,
        "dashboard",
        "action",
        action,
        allScreenQns,
        navTargetShortIds,
        screensByShortId,
        detailForScreens,
      );
      validateRowActionNavigateParams(
        featureName,
        screenId,
        "dashboard",
        screen.detailFor,
        action,
        target,
      );
    } else if (action.kind === "clientAction") {
      validateClientActionName(featureName, screenId, "dashboard", "action", action);
    } else {
      if (action.redirect !== undefined) {
        throw bootRuleError(DASHBOARD_RULES.actionRedirect, {
          message:
            `${where} sets redirect — a dashboard action stays on the dashboard and refetches ` +
            `after success. Remove redirect.`,
        });
      }
      assertWriteHandlerRegistered(
        featureName,
        `Screen "${screenId}" (dashboard) action "${action.id}"`,
        action.handler,
        allWriteHandlerQns,
      );
    }
  }
}

// record / actions / refresh hang together: actions and a field-driven refresh
// read the record row, and the record id travels in the URL next to the
// filter and time-range values.
export function validateDashboardRecordBinding(
  featureName: string,
  screenId: string,
  screen: DashboardScreenDefinition,
): void {
  const where = `[Feature ${featureName}] Screen "${screenId}" (dashboard)`;
  const { record, refresh } = screen;
  if (record === undefined) {
    if (screen.actions !== undefined) {
      throw bootRuleError(DASHBOARD_RULES.actionsWithoutRecord, {
        message:
          `${where} declares actions without a record — the actions run on the bound record. ` +
          `Add record: { param } or remove actions.`,
      });
    }
  } else {
    validateDashboardRecordShape(where, record, [screen.filter?.id, screen.timeRange?.id]);
  }
  // skip: no refresh declared, nothing to validate
  if (refresh === undefined) return;
  validateDashboardRefresh(where, refresh, record);
}

function validateDashboardRecordShape(
  where: string,
  record: DashboardRecordBinding,
  otherUrlParamIds: readonly (string | undefined)[],
): void {
  if (typeof record.param !== "string" || record.param.length === 0) {
    throw bootRuleError(DASHBOARD_RULES.recordParamEmpty, {
      message: `${where} record.param is empty. Name the URL search param carrying the id.`,
    });
  }
  if (record.payloadKey !== undefined && record.payloadKey.length === 0) {
    throw bootRuleError(DASHBOARD_RULES.recordPayloadKeyEmpty, {
      message: `${where} record.payloadKey is empty. Omit it to reuse record.param as the payload key.`,
    });
  }
  if (record.query !== undefined && record.query.length === 0) {
    throw bootRuleError(DASHBOARD_RULES.recordQueryEmpty, {
      message: `${where} record.query is empty. Set a registered query name or omit it.`,
    });
  }
  if (record.titleField !== undefined && isTitleFieldUnusable(record)) {
    throw bootRuleError(DASHBOARD_RULES.recordTitleFieldUnusable, {
      message:
        `${where} record.titleField needs record.query and a field name — the title is read ` +
        `from the record row.`,
    });
  }
  const payloadKey = record.payloadKey ?? record.param;
  for (const other of otherUrlParamIds) {
    if (other !== undefined && (other === record.param || other === payloadKey)) {
      throw bootRuleError(DASHBOARD_RULES.recordParamCollision, {
        message:
          `${where} record.param/payloadKey "${other}" collides with the filter or timeRange id — ` +
          `all of them live in the URL search params and panel payloads. Use a different name.`,
      });
    }
  }
}

function isTitleFieldUnusable(record: DashboardRecordBinding): boolean {
  return record.query === undefined || record.titleField === "";
}

function validateDashboardRefresh(
  where: string,
  refresh: DashboardRefresh,
  record: DashboardRecordBinding | undefined,
): void {
  if ("seconds" in refresh && "field" in refresh) {
    throw bootRuleError(DASHBOARD_RULES.refreshSecondsAndField, {
      message: `${where} refresh sets both seconds and field — set exactly one.`,
    });
  }
  if ("seconds" in refresh) {
    if (!isRefreshSecondsAllowed(refresh.seconds)) {
      throw bootRuleError(DASHBOARD_RULES.refreshSecondsTooShort, {
        message:
          `${where} refresh.seconds "${String(refresh.seconds)}" must be a number of at least ` +
          `${DASHBOARD_MIN_REFRESH_SECONDS} — shorter intervals would hammer every panel query.`,
      });
    }
    // skip: seconds validated, field rules below do not apply
    return;
  }
  if (refresh.field.length === 0) {
    throw bootRuleError(DASHBOARD_RULES.refreshFieldEmpty, {
      message: `${where} refresh.field is empty. Name the record field holding the seconds.`,
    });
  }
  if (record?.query === undefined) {
    throw bootRuleError(DASHBOARD_RULES.refreshFieldWithoutRecordQuery, {
      message:
        `${where} refresh.field "${refresh.field}" needs record.query to read the seconds from. ` +
        `Add record: { param, query } or use refresh: { seconds }.`,
    });
  }
}

function isRefreshSecondsAllowed(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= DASHBOARD_MIN_REFRESH_SECONDS;
}

function validateDashboardTimeRange(
  featureName: string,
  screenId: string,
  timeRange: DashboardTimeRangeDefinition,
  filterId: string | undefined,
): void {
  const prefix = `[Feature ${featureName}] Screen "${screenId}" (dashboard) timeRange`;
  if (timeRange.id.length === 0)
    throw bootRuleError(DASHBOARD_RULES.timeRangeIdEmpty, {
      message: `${prefix} has an empty id. Set a non-empty id.`,
    });
  if (timeRange.id === filterId) {
    throw bootRuleError(DASHBOARD_RULES.timeRangeIdCollidesFilter, {
      message: `${prefix} id "${timeRange.id}" collides with the filter id — both live in the URL search params. Use an id different from the filter id.`,
    });
  }
  if (timeRange.options.length === 0) {
    throw bootRuleError(DASHBOARD_RULES.timeRangeOptionsEmpty, {
      message: `${prefix}.options is empty — declare at least one option.`,
    });
  }
  const values = new Set<string>();
  for (const option of timeRange.options) {
    if (option.value.length === 0 || option.label.length === 0) {
      throw bootRuleError(DASHBOARD_RULES.timeRangeOptionIncomplete, {
        message: `${prefix} option needs a non-empty value and label. Give every option both.`,
      });
    }
    if (values.has(option.value)) {
      throw bootRuleError(DASHBOARD_RULES.timeRangeOptionDuplicate, {
        message: `${prefix}.options has duplicate value "${option.value}". Use each option value once.`,
      });
    }
    values.add(option.value);
  }
  if (!values.has(timeRange.default)) {
    throw bootRuleError(DASHBOARD_RULES.timeRangeDefaultUnknown, {
      message: `${prefix}.default "${timeRange.default}" is not among the options (${[...values].join(", ")}). Set default to one of the options.`,
    });
  }
}

const EMBEDDABLE_SCREEN_TYPES: ReadonlySet<ScreenDefinition["type"]> = new Set([
  "projectionList",
  "projectionDetail",
  "actionForm",
  "secretMint",
  "configEdit",
  "secretsEdit",
]);

function validateEmbeddableScreenRef(
  context: string,
  prop: "screen" | "fallback",
  ref: string,
  featureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  hostHasRecord: boolean | undefined,
): ScreenDefinition {
  const targetQn = resolveScreenTargetQn(featureName, ref);
  const [targetFeatureName = "", , targetShortId = ""] = targetQn.split(":");
  const target = featureMap.get(targetFeatureName)?.screens[targetShortId];
  if (target === undefined) {
    throw bootRuleError(DASHBOARD_RULES.embeddedScreenUnresolved, {
      message:
        `${context} ${prop} "${ref}" does not resolve to a registered screen (checked "${targetQn}"). ` +
        `Use a same-feature short id or a cross-feature QN "<feature>:screen:<id>".`,
    });
  }
  if (!EMBEDDABLE_SCREEN_TYPES.has(target.type)) {
    throw bootRuleError(DASHBOARD_RULES.embeddedScreenType, {
      message:
        `${context} embeds "${targetQn}" of type "${target.type}", which can't be embedded — allowed: ` +
        `${[...EMBEDDABLE_SCREEN_TYPES].join(", ")}. Use a custom panel for app components.`,
    });
  }
  // The tile hands the dashboard's bound record id to the detail screen; without a binding it has no id.
  // undefined = host unknown (extension-selector panels), checked nowhere else.
  if (target.type === "projectionDetail" && hostHasRecord === false) {
    throw bootRuleError(DASHBOARD_RULES.embeddedDetailWithoutRecord, {
      message:
        `${context} embeds "${targetQn}", a projectionDetail, but the host dashboard has no record binding ` +
        `to take its id from. Add record: { param } to the dashboard or embed another screen type.`,
    });
  }
  // ActionFormBody/SecretMintBody navigate via nav.navigate after submit or
  // cancel even when embedded, which would pull the user off the dashboard.
  if (
    (target.type === "actionForm" || target.type === "secretMint") &&
    (target.redirect !== undefined ||
      (target.cancelTarget !== undefined && target.cancelTarget !== false))
  ) {
    throw bootRuleError(DASHBOARD_RULES.embeddedFormNavigates, {
      message:
        `${context} embeds "${targetQn}", which sets redirect/cancelTarget — an embedded form would ` +
        `navigate away from the dashboard on submit or cancel. Embed a screen without redirect and ` +
        `with cancelTarget: false (or omitted).`,
    });
  }
  return target;
}

export function validateDashboardScreenPanel(
  featureName: string,
  screenId: string,
  panel: DashboardScreenPanel,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  hostHasRecord: boolean | undefined,
): void {
  const context = `[Feature ${featureName}] Screen "${screenId}" (dashboard) screen-panel "${panel.id}"`;
  validateEmbeddableScreenRef(
    context,
    "screen",
    panel.screen,
    featureName,
    featureMap,
    hostHasRecord,
  );
  validateDashboardPanelVisibleWhen(context, panel.visibleWhen);
  // skip: no fallback declared, nothing more to validate
  if (panel.fallback === undefined) return;
  if (panel.visibleWhen === undefined) {
    throw bootRuleError(DASHBOARD_RULES.panelFallbackWithoutVisibleWhen, {
      message: `${context} declares fallback without visibleWhen. Add visibleWhen or remove fallback.`,
    });
  }
  const target = validateEmbeddableScreenRef(
    context,
    "fallback",
    panel.fallback,
    featureName,
    featureMap,
    hostHasRecord,
  );
  // A gated fallback could hide in turn; the tile would show nothing where it promised a stand-in.
  if (target.visibleWhen !== undefined) {
    throw bootRuleError(DASHBOARD_RULES.panelFallbackGated, {
      message: `${context} fallback "${panel.fallback}" has its own visibleWhen; a fallback must always render.`,
    });
  }
}

function validateDashboardTextPanel(
  featureName: string,
  screenId: string,
  panel: DashboardTextPanel,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const context = `[Feature ${featureName}] Screen "${screenId}" (dashboard) text-panel "${panel.id}"`;
  if (panel.blocks.length === 0) {
    throw bootRuleError(DASHBOARD_RULES.textPanelEmpty, {
      message: `${context} has an empty blocks list. Add at least one block.`,
    });
  }
  validateDashboardPanelSpan(featureName, screenId, panel);
  validateDashboardPanelVisibleWhen(context, panel.visibleWhen);
  for (const block of panel.blocks) {
    if (block.kind === "list" && block.items.length === 0) {
      throw bootRuleError(DASHBOARD_RULES.textListBlockEmpty, {
        message: `${context} has a list block without items. Add items or remove the block.`,
      });
    }
    if (block.kind === "link")
      validateDashboardTextLinkBlock(context, block, featureName, featureMap);
  }
}

function validateDashboardTextLinkBlock(
  context: string,
  block: Extract<DashboardTextBlock, { readonly kind: "link" }>,
  featureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const targetQn = resolveScreenTargetQn(featureName, block.screen);
  const [targetFeatureName = "", , targetShortId = ""] = targetQn.split(":");
  if (featureMap.get(targetFeatureName)?.screens[targetShortId] === undefined) {
    throw bootRuleError(DASHBOARD_RULES.textLinkUnresolved, {
      message:
        `${context} link block screen "${block.screen}" does not resolve to a registered screen ` +
        `(checked "${targetQn}"). Use a same-feature short id or a cross-feature QN "<feature>:screen:<id>".`,
    });
  }
  if (block.roles?.length === 0) {
    throw bootRuleError(DASHBOARD_RULES.textLinkRolesEmpty, {
      message:
        `${context} link block "${block.screen}" has an empty roles list, which would hide it from everyone. ` +
        `List the roles or omit roles.`,
    });
  }
}

export function validateDashboardPanelVisibleWhen(
  context: string,
  visibleWhen: DashboardPanelVisibility | undefined,
): void {
  if (visibleWhen !== undefined && (visibleWhen.query === "" || visibleWhen.field === "")) {
    throw bootRuleError(DASHBOARD_RULES.panelVisibleWhenIncomplete, {
      message: `${context} visibleWhen needs a non-empty query and field. Set both visibleWhen.query and visibleWhen.field.`,
    });
  }
}

function validateDashboardPanelSpan(
  featureName: string,
  screenId: string,
  panel: { readonly id: string; readonly span?: unknown },
): void {
  if (panel.span !== undefined && panel.span !== "half" && panel.span !== "full") {
    throw bootRuleError(DASHBOARD_RULES.panelSpanInvalid, {
      message: `[Feature ${featureName}] Screen "${screenId}" (dashboard) panel "${panel.id}" has span "${String(panel.span)}" — expected "half" or "full".`,
    });
  }
}

function validateDashboardStatGroupPanel(
  featureName: string,
  screenId: string,
  panel: DashboardStatGroupPanel,
  addPanelId: (id: string, context: string) => void,
): void {
  const context = `[Feature ${featureName}] Screen "${screenId}" (dashboard) stat-group "${panel.id}"`;
  if (panel.stats.length === 0) {
    throw bootRuleError(DASHBOARD_RULES.statGroupEmpty, {
      message: `${context} has an empty stats list. Add at least one stat.`,
    });
  }
  if (panel.subtitle !== undefined && panel.label === undefined) {
    throw bootRuleError(DASHBOARD_RULES.statGroupSubtitleWithoutLabel, {
      message: `${context} sets subtitle without label — an unlabeled group renders as a KPI strip without a header. Set a label or remove subtitle.`,
    });
  }
  validateDashboardPanelSpan(featureName, screenId, panel);
  validateDashboardPanelVisibleWhen(context, panel.visibleWhen);
  for (const stat of panel.stats) {
    addPanelId(stat.id, "stat-group child");
    if (stat.visibleWhen !== undefined) {
      throw bootRuleError(DASHBOARD_RULES.statGroupChildVisibleWhen, {
        message: `${context} child "${stat.id}" sets visibleWhen — gate the whole group instead; a hidden cell would leave a gap in the strip.`,
      });
    }
    if (!stat.query || typeof stat.query !== "string") {
      throw bootRuleError(DASHBOARD_RULES.panelQueryEmpty, {
        message: `[Feature ${featureName}] Screen "${screenId}" (dashboard) stat-group "${panel.id}" child "${stat.id}" has empty or non-string query. Set query to a registered query name.`,
      });
    }
    if (stat.valueField.length === 0) {
      throw bootRuleError(DASHBOARD_RULES.statValueFieldEmpty, {
        message: `[Feature ${featureName}] Screen "${screenId}" (dashboard) stat-group "${panel.id}" child "${stat.id}" has empty valueField. Set valueField to a field of the query result.`,
      });
    }
    validateDashboardValueFormat(
      featureName,
      screenId,
      stat.id,
      stat.valueFormat,
      STAT_VALUE_FORMATS,
    );
  }
}

function validateFromTodayWindowReach(where: string, panel: DashboardChartPanel): void {
  if (panel.initialWindow === "from-today" && panel.ranges === undefined && panel.brush !== true) {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartFromTodayUnreachable, {
      message: `${where}.initialWindow "from-today" needs ranges or brush, otherwise data before today is unreachable.`,
    });
  }
}

function validateChartScrollableAndUnit(where: string, panel: DashboardChartPanel): void {
  if (panel.scrollable !== undefined && typeof panel.scrollable !== "boolean") {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartFlagNonBoolean, {
      message: `${where} has a non-boolean scrollable. Use true or false.`,
    });
  }
  if (panel.scrollable === true && panel.chart !== "stacked-area") {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartStackedAreaOnly, {
      message: `${where} sets scrollable on chart "${panel.chart}" — only "stacked-area" supports it. Remove scrollable or use chart "stacked-area".`,
    });
  }
  if (panel.unit !== undefined && panel.chart !== "timeseries") {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartUnitTimeseriesOnly, {
      message: `${where} sets unit on chart "${panel.chart}" — only "timeseries" supports it. Remove unit or use chart "timeseries".`,
    });
  }
}

function validateDashboardChartDisplay(
  featureName: string,
  screenId: string,
  panel: DashboardChartPanel,
): void {
  validateDashboardValueFormat(
    featureName,
    screenId,
    panel.id,
    panel.valueFormat,
    CHART_VALUE_FORMATS,
  );
  const where = `[Feature ${featureName}] Screen "${screenId}" (dashboard) chart-panel "${panel.id}"`;
  validateChartScrollableAndUnit(where, panel);
  validateStackedAreaOnlyProps(where, panel);
  validateStackedAreaEnumProp(where, "dateFormat", panel.dateFormat, ["day", "month"]);
  validateStackedAreaEnumProp(where, "initialWindow", panel.initialWindow, [
    "default-range",
    "from-today",
  ]);
  validateStackedAreaEnumProp(where, "markerLegend", panel.markerLegend, ["list", "legend"]);
  const nonBooleanProp = (["brush", "legendTotals", "markerLabels"] as const).find(
    (prop) => panel[prop] !== undefined && typeof panel[prop] !== "boolean",
  );
  if (nonBooleanProp !== undefined) {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartFlagNonBoolean, {
      message: `${where} has a non-boolean ${nonBooleanProp}. Use true or false.`,
    });
  }
  validateFromTodayWindowReach(where, panel);
  for (const [key, color] of Object.entries(panel.seriesColors ?? {})) {
    if (typeof color !== "string" || color.trim() === "") {
      throw bootRuleError(DASHBOARD_CHART_RULES.chartColorInvalid, {
        message: `${where} seriesColors["${key}"] must be a non-empty CSS color.`,
      });
    }
  }
  for (const [kind, look] of Object.entries(panel.markerKinds ?? {})) {
    validateDashboardChartMarkerKind(`${where} markerKinds["${kind}"]`, look);
  }
  if (panel.ranges !== undefined) validateDashboardChartRanges(`${where} ranges`, panel.ranges);
}

function validateStackedAreaEnumProp(
  where: string,
  prop: string,
  value: string | undefined,
  allowed: readonly string[],
): void {
  // skip: optional prop, nothing to validate when unset
  if (value === undefined) return;
  if (!allowed.includes(value)) {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartEnumPropInvalid, {
      message: `${where}.${prop} "${String(value)}" must be one of ${allowed.join(", ")}.`,
    });
  }
}

function validateStackedAreaOnlyProps(where: string, panel: DashboardChartPanel): void {
  // skip: stacked-area is the one chart kind that supports these props
  if (panel.chart === "stacked-area") return;
  const stackedAreaOnly = (
    [
      "markerKinds",
      "legendTotals",
      "ranges",
      "brush",
      "dateFormat",
      "initialWindow",
      "markerLegend",
      "markerLabels",
    ] as const
  ).filter((prop) => panel[prop] !== undefined);
  if (stackedAreaOnly.length > 0) {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartStackedAreaOnly, {
      message: `${where} sets ${stackedAreaOnly.join(", ")} on chart "${panel.chart}" — only "stacked-area" supports it. Remove these props or use chart "stacked-area".`,
    });
  }
}

const DASHBOARD_CHART_TONES: ReadonlySet<string> = new Set([
  "positive",
  "negative",
  "active",
  "neutral",
] satisfies DashboardChartTone[]);

function validateDashboardChartMarkerKind(where: string, look: DashboardChartMarkerKind): void {
  if (look.tone === undefined && look.color === undefined) {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartMarkerLookMissing, {
      message: `${where} needs a tone or a color. Set tone or color.`,
    });
  }
  if (look.tone !== undefined && !DASHBOARD_CHART_TONES.has(look.tone)) {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartMarkerToneInvalid, {
      message: `${where}.tone "${String(look.tone)}" is not one of ${[...DASHBOARD_CHART_TONES].join(", ")}.`,
    });
  }
  if (look.color !== undefined && (typeof look.color !== "string" || look.color.trim() === "")) {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartColorInvalid, {
      message: `${where}.color must be a non-empty CSS color.`,
    });
  }
  if (look.label !== undefined && (typeof look.label !== "string" || look.label.trim() === "")) {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartMarkerLabelInvalid, {
      message: `${where}.label must be a non-empty i18n key.`,
    });
  }
}

function validateDashboardChartRanges(where: string, ranges: DashboardChartRanges): void {
  if (ranges.options.length === 0) {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartRangesOptionsEmpty, {
      message: `${where}.options is empty — declare at least one option.`,
    });
  }
  const values = new Set<string>();
  for (const option of ranges.options) {
    if (option.value.length === 0 || option.label.length === 0) {
      throw bootRuleError(DASHBOARD_CHART_RULES.chartRangesOptionIncomplete, {
        message: `${where} option needs a non-empty value and label. Give every option both.`,
      });
    }
    if (values.has(option.value)) {
      throw bootRuleError(DASHBOARD_CHART_RULES.chartRangesOptionDuplicate, {
        message: `${where}.options has duplicate value "${option.value}". Use each option value once.`,
      });
    }
    if (option.months !== undefined && (!Number.isInteger(option.months) || option.months <= 0)) {
      throw bootRuleError(DASHBOARD_CHART_RULES.chartRangesMonthsInvalid, {
        message: `${where} option "${option.value}" months "${String(option.months)}" must be a positive integer.`,
      });
    }
    values.add(option.value);
  }
  if (!values.has(ranges.default)) {
    throw bootRuleError(DASHBOARD_CHART_RULES.chartRangesDefaultUnknown, {
      message: `${where}.default "${ranges.default}" is not among the options (${[...values].join(", ")}). Set default to one of the options.`,
    });
  }
}

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

const MAX_VALUE_FORMAT_FRACTION_DIGITS = 4;

const STAT_VALUE_FORMATS = [
  "currency",
  "relativeTime",
] as const satisfies readonly DashboardValueFormat["kind"][];

const CHART_VALUE_FORMATS = ["currency"] as const satisfies readonly DashboardValueFormat["kind"][];

function validateDashboardValueFormat(
  featureName: string,
  screenId: string,
  panelId: string,
  valueFormat: DashboardValueFormat | undefined,
  allowedKinds: readonly DashboardValueFormat["kind"][],
): void {
  // skip: valueFormat is optional, nothing to validate without it
  if (valueFormat === undefined) return;
  const where = `[Feature ${featureName}] Screen "${screenId}" (dashboard) panel "${panelId}" valueFormat`;
  if (!allowedKinds.includes(valueFormat.kind)) {
    throw bootRuleError(DASHBOARD_CHART_RULES.valueFormatKind, {
      message: `${where}.kind "${String(valueFormat.kind)}" must be ${allowedKinds.map((kind) => `"${kind}"`).join(" or ")}.`,
    });
  }
  // skip: relativeTime carries no options
  if (valueFormat.kind === "relativeTime") return;
  if (!CURRENCY_CODE_RE.test(valueFormat.currency)) {
    throw bootRuleError(DASHBOARD_CHART_RULES.valueFormatCurrency, {
      message: `${where}.currency "${String(valueFormat.currency)}" must be a 3-letter uppercase ISO currency code.`,
    });
  }
  const digits = valueFormat.fractionDigits;
  if (
    digits !== undefined &&
    (!Number.isInteger(digits) || digits < 0 || digits > MAX_VALUE_FORMAT_FRACTION_DIGITS)
  ) {
    throw bootRuleError(DASHBOARD_CHART_RULES.valueFormatFractionDigits, {
      message: `${where}.fractionDigits "${String(digits)}" must be an integer from 0 to ${MAX_VALUE_FORMAT_FRACTION_DIGITS}.`,
    });
  }
}

export function validateDashboardCustomPanel(
  featureName: string,
  screenId: string,
  panel: DashboardCustomPanel,
): void {
  if (panel.component.react === undefined && panel.component.native === undefined) {
    throw bootRuleError(DASHBOARD_RULES.customPanelNoComponent, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (dashboard) custom-panel "${panel.id}" has no component — ` +
        `declare a react/native component marker.`,
    });
  }
}

function validateDashboardQueryPanel(
  featureName: string,
  screenId: string,
  panel: Exclude<
    DashboardPanelDefinition,
    DashboardStatGroupPanel | DashboardCustomPanel | DashboardScreenPanel | DashboardTextPanel
  >,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  if (!panel.query || typeof panel.query !== "string") {
    throw bootRuleError(DASHBOARD_RULES.panelQueryEmpty, {
      message: `[Feature ${featureName}] Screen "${screenId}" (dashboard) panel "${panel.id}" has empty or non-string query. Set query to a registered query name.`,
    });
  }
  validateDashboardPanelSpan(featureName, screenId, panel);
  if (panel.kind === "stat") {
    if (panel.valueField.length === 0) {
      throw bootRuleError(DASHBOARD_RULES.statValueFieldEmpty, {
        message: `[Feature ${featureName}] Screen "${screenId}" (dashboard) stat-panel "${panel.id}" has empty valueField. Set valueField to a field of the query result.`,
      });
    }
    validateDashboardValueFormat(
      featureName,
      screenId,
      panel.id,
      panel.valueFormat,
      STAT_VALUE_FORMATS,
    );
  }
  validateDashboardPanelVisibleWhen(
    `[Feature ${featureName}] Screen "${screenId}" (dashboard) panel "${panel.id}"`,
    panel.visibleWhen,
  );
  if (panel.kind === "chart") validateDashboardChartDisplay(featureName, screenId, panel);
  if (panel.kind === "list") {
    if (panel.columns.length === 0) {
      throw bootRuleError(DASHBOARD_RULES.listPanelColumnsEmpty, {
        message: `[Feature ${featureName}] Screen "${screenId}" (dashboard) list-panel "${panel.id}" has an empty columns list. Add at least one column.`,
      });
    }
    for (const col of panel.columns) {
      const normalized = normalizeListColumn(col);
      validateColumnRendererForm(featureName, screenId, normalized);
      if (normalized.refEntity !== undefined) {
        assertRefTargetRegistered(
          `[Feature ${featureName}] Screen "${screenId}" (dashboard) list-panel "${panel.id}"`,
          `column "${normalized.field}" (refEntity)`,
          normalized.refEntity,
          featureName,
          featureMap,
        );
      }
    }
  }
}

function validateDashboardFilterDefinition(
  featureName: string,
  screenId: string,
  filter: DashboardFilterDefinition,
): void {
  if (filter.id.length === 0) {
    throw bootRuleError(DASHBOARD_RULES.filterIdEmpty, {
      message: `[Feature ${featureName}] Screen "${screenId}" (dashboard) filter has an empty id. Set a non-empty id.`,
    });
  }
  if (filter.label.length === 0) {
    throw bootRuleError(DASHBOARD_RULES.filterLabelEmpty, {
      message: `[Feature ${featureName}] Screen "${screenId}" (dashboard) filter has an empty label. Set a non-empty label.`,
    });
  }
  const hasOptions = filter.options !== undefined;
  const hasOptionsQuery = filter.optionsQuery !== undefined;
  if (hasOptions === hasOptionsQuery) {
    throw bootRuleError(DASHBOARD_RULES.filterOptionsXor, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (dashboard) filter must set exactly one of ` +
        `options/optionsQuery.`,
    });
  }
  if (hasOptions && (filter.options?.length ?? 0) === 0) {
    throw bootRuleError(DASHBOARD_RULES.filterOptionsEmpty, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (dashboard) filter.options is empty — ` +
        `declare at least one option or use optionsQuery instead.`,
    });
  }
  if (hasOptionsQuery && filter.optionsQuery?.length === 0) {
    throw bootRuleError(DASHBOARD_RULES.filterOptionsQueryEmpty, {
      message: `[Feature ${featureName}] Screen "${screenId}" (dashboard) filter.optionsQuery is empty. Set optionsQuery to a query name or remove it.`,
    });
  }
}
