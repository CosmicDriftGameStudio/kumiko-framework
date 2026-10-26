// Web implementation of the dashboard screen type: renders the declared
// panels via the widget kit (StatCard, charts, FeedList, ProgressList,
// DashboardListTable) in a responsive grid. Registered via
// DashboardBodyProvider in createKumikoApp so the KumikoScreen switch stays
// platform-agnostic.
//
// Panel data contracts (see DashboardPanelDefinition in kumiko-framework):
//   stat          → flat record; valueField/subField/toneField point at
//                   values (strings are display-ready, DashboardI18nText is
//                   translated, the renderer formats numbers with the user
//                   locale; `valueFormat` renders them as currency from minor
//                   units). sparklineField → { atMs, value }[].
//                   deltaField/deltaDirectionField(+deltaToneField) are
//                   optional: the tile shows a delta chip ("↓23 %") only when
//                   BOTH fields are configured AND returned.
//                   icon/accentColor are static on the panel (not query
//                   fields): icon goes through extensionSectionComponents like
//                   custom panels, accentColor is a raw CSS color value.
//   stat-group    → several stat panels, each child stays an independent
//                   query; with a label it sits under a section title,
//                   without one it renders as a flat KPI strip. `span` works
//                   like on other panels; columns follow the number of values.
//   chart         → depends on `chart`: timeseries { points, windowStartMs,
//                   windowEndMs, markers? }, stacked-bars / stacked-area
//                   { series, windowStartMs, windowEndMs, todayMs?, markers? }
//                   (marker labels: DashboardText; `scrollable`, `ranges` and
//                   `brush` only for stacked-area),
//                   segment-bars { rows: { key, label, value, segments }[] }
//   list          → paged envelope { rows, nextCursor, total? } like
//                   projectionList.
//   feed          → { rows: { primary: DashboardText, trailing?: DashboardText }[] }
//   progress-list → { rows: { label: DashboardText, value: DashboardText, fraction }[] }
//                   or, per row, used / limit instead of value / fraction
//   text          → no query; static `blocks` (heading, paragraph, list, code, hint),
//                   text/items are i18n keys, code is shown verbatim.
//   custom        → no query; an app component registered via
//                   extensionSectionComponents fetches its own data.
//   screen        → no own query; embeds another declarative screen via
//                   KumikoScreen. visibleWhen reads a flat record (live); the
//                   tile is dropped when the user can't access the target.
//
// Screen filter (DashboardFilterDefinition) and time range (timeRange): the
// selected values are merged into the panel queries under `filter.id` /
// `timeRange.id` (panel `params` win, `ignoreScreenFilter` drops only the
// filter). useQuery refetches automatically through its existing payloadKey
// mechanism, so no special case is needed. Each query panel loads and fails
// on its own (skeleton / empty / error with retry).
//
// Record binding (DashboardRecordBinding): the record id from the URL search
// param is merged into every panel and gate query after filter/timeRange and
// before panel `params`. Without the param the screen shows a hint and runs no
// query. `record.query` loads the row for the title, header `actions` and
// `refresh.field`; an action success and every refresh tick refetch the record
// and all panels (each panel query registers its refetch in the registry).

import type {
  DashboardPanelDefinition,
  DashboardScreenPanel,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { Translate } from "../../headless/index.ts";
import {
  type DashboardBodyProps,
  useNav,
  usePageHeaderCompact,
  usePageHeaderSlotAvailable,
  usePrimitives,
  useTranslation,
} from "../../index.ts";
import { PageSection } from "../primitives/layout.tsx";
import {
  buildScopeBadge,
  type DashboardHeaderModel,
  dashboardDescription,
  recordTitleText,
  renderActionErrorBanner,
  renderDescriptionAndNotice,
  renderHeaderActionsBar,
  renderPageHeaderSlot,
  renderRecordError,
  renderRecordMissing,
  renderTitleRow,
} from "./dashboard-header.tsx";
import {
  ChartPanelBody,
  CustomPanelBody,
  FeedPanelBody,
  ListPanelBody,
  ProgressListPanelBody,
  StatGroupPanelBody,
  StatPanelBody,
  TextPanelBody,
} from "./dashboard-panels.tsx";
import { ScreenPanelTile } from "./dashboard-screen-tiles.tsx";
import {
  DashboardQueryContext,
  HALF_PANEL,
  PanelLoadedContext,
  type ScreenParams,
  useDashboardFormats,
  WIDE_PANEL,
} from "./dashboard-shared.tsx";
import {
  GatedGridCell,
  useDashboardVisibility,
  VisibilityGateQueries,
  VisibilityQueryContext,
} from "./dashboard-visibility.tsx";
import {
  useDashboardHeaderActions,
  useDashboardRecord,
  useDashboardScreenParams,
} from "./use-dashboard-screen-state.ts";

function panelSpanClassName(panel: DashboardPanelDefinition): string | undefined {
  if (panel.kind === "stat") return undefined;
  if ("span" in panel && panel.span !== undefined)
    return panel.span === "half" ? HALF_PANEL : WIDE_PANEL;
  if (panel.kind === "feed" || panel.kind === "progress-list") return HALF_PANEL;
  return WIDE_PANEL;
}

function PanelBody({
  panel,
  label,
  screenId,
  screenParams,
  translate,
}: {
  readonly panel: Exclude<DashboardPanelDefinition, DashboardScreenPanel>;
  readonly label: string | undefined;
  readonly screenId: string;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
}): ReactNode {
  if (panel.kind === "stat-group") {
    return (
      <StatGroupPanelBody
        panel={panel}
        label={label}
        screenId={screenId}
        screenParams={screenParams}
        translate={translate}
      />
    );
  }
  if (panel.kind === "custom") {
    return (
      <CustomPanelBody
        panel={panel}
        screenId={screenId}
        filterParams={{
          ...screenParams.filterParams,
          ...screenParams.rangeParams,
          ...screenParams.recordParams,
          ...panel.params,
        }}
      />
    );
  }
  const text = label ?? "";
  if (panel.kind === "stat") {
    return (
      <StatPanelBody
        panel={panel}
        label={text}
        screenId={screenId}
        screenParams={screenParams}
        translate={translate}
        variant="card"
      />
    );
  }
  if (panel.kind === "chart") {
    return (
      <ChartPanelBody
        panel={panel}
        label={text}
        screenParams={screenParams}
        translate={translate}
      />
    );
  }
  if (panel.kind === "list") {
    return (
      <ListPanelBody panel={panel} label={text} screenParams={screenParams} translate={translate} />
    );
  }
  if (panel.kind === "feed") {
    return (
      <FeedPanelBody panel={panel} label={text} screenParams={screenParams} translate={translate} />
    );
  }
  if (panel.kind === "text") {
    return <TextPanelBody panel={panel} label={label} translate={translate} />;
  }
  return (
    <ProgressListPanelBody
      panel={panel}
      label={text}
      screenParams={screenParams}
      translate={translate}
    />
  );
}

function renderDashboardPanel(
  panel: DashboardPanelDefinition,
  featureName: string,
  screenId: string,
  screenParams: ScreenParams,
  translate: Translate,
): ReactNode {
  if (panel.kind === "screen") {
    return (
      <ScreenPanelTile
        key={panel.id}
        panel={panel}
        featureName={featureName}
        recordId={screenParams.recordId}
        translate={translate}
      />
    );
  }
  const label =
    panel.kind === "custom" || panel.label === undefined ? undefined : translate(panel.label);
  return (
    <GatedGridCell
      key={panel.id}
      panel={panel}
      screenParams={screenParams}
      label={label ?? panel.id}
      className={panelSpanClassName(panel)}
    >
      <PanelBody
        panel={panel}
        label={label}
        screenId={screenId}
        screenParams={screenParams}
        translate={translate}
      />
    </GatedGridCell>
  );
}

export function WebDashboardBody({
  featureName,
  screen,
  translate,
}: DashboardBodyProps): ReactNode {
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const primitives = usePrimitives();
  const nav = useNav();
  const headerSlotAvailable = usePageHeaderSlotAvailable();
  const headerCompactContext = usePageHeaderCompact();
  const { formatDateTime } = useDashboardFormats();

  const params = useDashboardScreenParams(screen, effectiveTranslate, nav);
  const { screenParams } = params;
  const visibility = useDashboardVisibility(screen.panels, screenParams);
  const record = useDashboardRecord(screen, params);
  const { recordQuery, recordRow, refetchRecord } = record;
  const { actionError, setActionError, headerActions } = useDashboardHeaderActions(
    screen,
    params,
    record,
    effectiveTranslate,
  );

  const description = dashboardDescription(screen, effectiveTranslate);
  const scopeBadge = buildScopeBadge(screen, effectiveTranslate);

  if (params.recordMissing) {
    return (
      <PageSection className="flex flex-col gap-4" testId={`dashboard-${screen.id}`}>
        {renderRecordMissing(primitives, t, screen.id)}
      </PageSection>
    );
  }

  const usesPageHeaderSlot = headerSlotAvailable && primitives.PageHeader !== undefined;
  const model: DashboardHeaderModel = {
    screen,
    t,
    translate: effectiveTranslate,
    primitives,
    headerActions,
    setActionError,
    headerCompactContext,
    usesPageHeaderSlot,
    recordTitle: recordTitleText(recordRow, params.recordBinding?.titleField),
    scopeBadge,
    picker: params.picker,
    rangeControl: params.rangeControl,
    loadedAtMs: params.loadedAtMs,
    formatDateTime,
  };
  const headerActionsBar = renderHeaderActionsBar(model);
  // The shell header owns the title; the badge and the actions sit in it there.
  const badgeInHeader = scopeBadge !== null && usesPageHeaderSlot;
  return (
    <PanelLoadedContext.Provider value={params.reportLoaded}>
      <DashboardQueryContext.Provider value={record.queryRuntime}>
        <PageSection className="flex flex-col gap-4" testId={`dashboard-${screen.id}`}>
          {renderPageHeaderSlot(model, headerActionsBar, badgeInHeader)}
          {renderTitleRow(model, headerActionsBar, badgeInHeader)}
          {renderActionErrorBanner(primitives, actionError)}
          {renderRecordError(model, recordQuery.error, recordRow, refetchRecord)}
          {renderDescriptionAndNotice(model, description)}
          <VisibilityQueryContext.Provider value={visibility.gateResultsWithPending}>
            <VisibilityGateQueries
              gates={visibility.visibilityGates}
              onResult={visibility.gateResults.report}
              onForget={visibility.gateResults.forget}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {screen.panels.map((panel) =>
                renderDashboardPanel(
                  panel,
                  featureName,
                  screen.id,
                  screenParams,
                  effectiveTranslate,
                ),
              )}
            </div>
          </VisibilityQueryContext.Provider>
        </PageSection>
      </DashboardQueryContext.Provider>
    </PanelLoadedContext.Provider>
  );
}
