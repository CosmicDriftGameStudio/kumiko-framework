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
  DashboardScreenDefinition,
  DashboardScreenPanel,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type ErrorNotice, ErrorReference } from "../../app/error-reference.tsx";
import type { Translate } from "../../headless/index.ts";
import {
  type DashboardBodyProps,
  dispatcherErrorText,
  EmbeddedScreenProvider,
  type EmbeddedScreenTarget,
  evalVisibleWhen,
  HeaderActionsBar,
  KumikoScreen,
  type UseQueryResult,
  useEmbeddedScreen,
  useLocale,
  useNav,
  usePageHeaderCompact,
  usePageHeaderSlotAvailable,
  usePrimitives,
  useQuery,
  useRecordActions,
  useTranslation,
} from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { EmbeddedFormProvider } from "../primitives/index.tsx";
import { PageSection } from "../primitives/layout.tsx";
import { ModeSwitch } from "../widgets/mode-switch.tsx";
import { SectionCard } from "../widgets/section-card.tsx";
import { StatusBadge } from "../widgets/status-badge.tsx";
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
import { resolveRefreshIntervalMs } from "./dashboard-refresh.ts";
import {
  DashboardQueryContext,
  HALF_PANEL,
  PanelError,
  PanelLoadedContext,
  type ScreenParams,
  useDashboardFormats,
  useDashboardQuery,
  useLoadedAt,
  useRefetchRegistry,
  WIDE_PANEL,
} from "./dashboard-shared.tsx";

// Value lives in the URL under `filter.id` (like useListUrlState's
// `<screenId>.page`, same replaceState) so a `navigate` rowAction with
// `params` can deep-link onto this filter.
function useFilterParams(
  screen: DashboardScreenDefinition,
  enabled: boolean,
): {
  readonly params: Readonly<Record<string, unknown>>;
  readonly picker: ReactNode;
} {
  const { Field, Input } = usePrimitives();
  const t = useTranslation();
  const nav = useNav();
  const filter = screen.filter;
  const value = filter !== undefined ? (nav.searchParams[filter.id] ?? "") : "";
  const optionsQueryResult = useQuery<{
    readonly rows: readonly { readonly value: string; readonly label: string }[];
  }>(filter?.optionsQuery ?? "", {}, { enabled: enabled && filter?.optionsQuery !== undefined });

  if (filter === undefined) {
    return { params: {}, picker: null };
  }

  const dynamicOptions =
    filter.optionsQuery !== undefined
      ? (optionsQueryResult.data?.rows ?? [])
      : (filter.options ?? []).map((o) => ({ value: o.value, label: t(o.label) }));
  const allLabel = t(filter.allLabel ?? "kumiko.dashboard.filter.all");
  const options = [{ value: "", label: allLabel }, ...dynamicOptions];

  const picker = (
    <div className="max-w-xs">
      <Field id={`dashboard-filter-${filter.id}`} label={t(filter.label)}>
        <Input
          kind="combobox"
          id={`dashboard-filter-${filter.id}`}
          name={filter.id}
          options={options}
          value={value}
          onChange={(next: string) =>
            nav.setSearchParams({ [filter.id]: next === "" ? null : next })
          }
          placeholder={filter.placeholder !== undefined ? t(filter.placeholder) : allLabel}
        />
      </Field>
    </div>
  );
  const params = value === "" ? {} : { [filter.id]: value };
  return { params, picker };
}

// An unknown/stale URL value falls back to the declared default.
function useTimeRange(
  screen: DashboardScreenDefinition,
  translate: Translate,
): { readonly params: Readonly<Record<string, unknown>>; readonly control: ReactNode } {
  const t = useTranslation();
  const nav = useNav();
  const resolver = useLocale();
  const timeRange = screen.timeRange;
  if (timeRange === undefined) return { params: {}, control: null };
  const fromUrl = nav.searchParams[timeRange.id];
  const value = timeRange.options.find((o) => o.value === fromUrl)?.value ?? timeRange.default;
  return {
    // Metric buckets are cut server-side; without the user's zone they default
    // to UTC while the axis labels are formatted in the user's zone.
    params: { [timeRange.id]: value, timeZone: resolver.timeZone() },
    control: (
      <ModeSwitch
        value={value}
        options={timeRange.options.map((o) => ({ value: o.value, label: translate(o.label) }))}
        onChange={(next) => nav.setSearchParams({ [timeRange.id]: next })}
        ariaLabel={t("kumiko.dashboard.time-range")}
        testId={`dashboard-time-range-${timeRange.id}`}
      />
    ),
  };
}

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

type VisibilityQueryResult = UseQueryResult<Readonly<Record<string, unknown>>>;

type VisibilityQueryResults = ReadonlyMap<string, VisibilityQueryResult>;

const VisibilityQueryContext = createContext<VisibilityQueryResults>(new Map());

type VisibilityGate = {
  readonly key: string;
  readonly query: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

const NO_GATE_PAYLOAD: Readonly<Record<string, unknown>> = {};

function visibilityGate(query: string, payload: Readonly<Record<string, unknown>>): VisibilityGate {
  return { key: `${query}|${JSON.stringify(payload)}`, query, payload };
}

// Embedded screens carry no screen filter; in-grid panels pass the filter
// (unless ignoreScreenFilter, never for a stat-group) and the time range.
function panelVisibilityGate(
  panel: DashboardPanelDefinition,
  screenParams: ScreenParams,
): VisibilityGate | undefined {
  if (panel.kind === "custom" || panel.visibleWhen === undefined) return undefined;
  if (panel.kind === "screen") return visibilityGate(panel.visibleWhen.query, NO_GATE_PAYLOAD);
  const dropsFilter =
    panel.kind !== "stat-group" && panel.kind !== "text" && panel.ignoreScreenFilter === true;
  return visibilityGate(panel.visibleWhen.query, {
    ...(dropsFilter ? {} : screenParams.filterParams),
    ...screenParams.rangeParams,
    ...screenParams.recordParams,
  });
}

// One live query per distinct gate (query + payload), shared by every panel
// that gates on it — N panels on the same status query would otherwise each
// open their own request, SSE subscription and refetch per event. The queries
// run as keyed siblings of the grid so a changing gate count never changes the
// grid's position in the tree (which would remount every panel).
function VisibilityGateQuery({
  gate,
  onResult,
  onForget,
}: {
  readonly gate: VisibilityGate;
  readonly onResult: (key: string, result: VisibilityQueryResult) => void;
  readonly onForget: (key: string) => void;
}): null {
  const { data, error, loading, refetch } = useDashboardQuery<Readonly<Record<string, unknown>>>(
    gate.query,
    gate.payload,
  );
  const { key } = gate;
  useEffect(() => {
    onResult(key, { data, error, loading, refetch });
  }, [key, data, error, loading, refetch, onResult]);
  useEffect(() => () => onForget(key), [key, onForget]);
  return null;
}

function VisibilityGateQueries({
  gates,
  onResult,
  onForget,
}: {
  readonly gates: readonly VisibilityGate[];
  readonly onResult: (key: string, result: VisibilityQueryResult) => void;
  readonly onForget: (key: string) => void;
}): ReactNode {
  return gates.map((gate) => (
    <VisibilityGateQuery key={gate.key} gate={gate} onResult={onResult} onForget={onForget} />
  ));
}

function useVisibilityGateResults(): {
  readonly results: VisibilityQueryResults;
  readonly report: (key: string, result: VisibilityQueryResult) => void;
  readonly forget: (key: string) => void;
} {
  const [results, setResults] = useState<VisibilityQueryResults>(new Map());
  const report = useCallback((key: string, result: VisibilityQueryResult) => {
    setResults((prev) => new Map(prev).set(key, result));
  }, []);
  const forget = useCallback((key: string) => {
    setResults((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);
  return { results, report, forget };
}

const NOOP_REFETCH = async (): Promise<void> => {};

// A gate reports through an effect, so for its first commit (and after a payload change) no
// result exists yet; without a placeholder that reads as "hidden" and flashes the fallback.
function withPendingGates(
  results: VisibilityQueryResults,
  gateKeys: readonly string[],
): VisibilityQueryResults {
  if (gateKeys.every((key) => results.has(key))) return results;
  const merged = new Map(results);
  for (const key of gateKeys) {
    if (!merged.has(key)) {
      merged.set(key, { data: null, error: null, loading: true, refetch: NOOP_REFETCH });
    }
  }
  return merged;
}

function distinctVisibilityGates(
  panels: readonly DashboardPanelDefinition[],
  screenParams: ScreenParams,
): VisibilityGate[] {
  const gates = new Map<string, VisibilityGate>();
  for (const panel of panels) {
    const gate = panelVisibilityGate(panel, screenParams);
    if (gate !== undefined) gates.set(gate.key, gate);
  }
  return [...gates.values()];
}

function GatedGridCell({
  panel,
  screenParams,
  label,
  className,
  children,
}: {
  readonly panel: Exclude<DashboardPanelDefinition, DashboardScreenPanel>;
  readonly screenParams: ScreenParams;
  readonly label: string;
  readonly className: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const gate = panelVisibilityGate(panel, screenParams);
  const visibility = useContext(VisibilityQueryContext).get(gate?.key ?? "");
  const visibleWhen = panel.kind === "custom" ? undefined : panel.visibleWhen;
  if (visibleWhen !== undefined) {
    const verdict = evalVisibleWhen(visibleWhen, visibility);
    if (verdict === "error" && visibility?.error) {
      return (
        <div className={cn("min-w-0", className)} data-testid={`dashboard-panel-${panel.id}`}>
          <PanelError
            label={label}
            error={visibility.error}
            onRetry={() => void visibility.refetch()}
          />
        </div>
      );
    }
    // Loading renders nothing too: a skeleton that then vanishes flickers.
    if (verdict !== "visible") return null;
  }
  return <div className={cn("min-w-0", className)}>{children}</div>;
}

function EmbeddedScreenPanelTile({
  panel,
  target,
  translate,
}: {
  readonly panel: DashboardScreenPanel;
  readonly target: EmbeddedScreenTarget;
  readonly translate: Translate;
}): ReactNode {
  const screenBody = <KumikoScreen schema={target.schema} qn={target.qn} translate={translate} />;
  const embedded =
    panel.chromeless === true ? (
      <EmbeddedFormProvider>
        <EmbeddedScreenProvider>{screenBody}</EmbeddedScreenProvider>
      </EmbeddedFormProvider>
    ) : (
      screenBody
    );
  return (
    <div className={cn("min-w-0", WIDE_PANEL)} data-testid={`dashboard-panel-${panel.id}`}>
      {panel.label !== undefined && panel.chromeless !== true ? (
        <SectionCard title={translate(panel.label)}>{embedded}</SectionCard>
      ) : (
        <>
          {panel.label !== undefined && (
            <h3 className="mb-3 text-sm font-semibold text-foreground">{translate(panel.label)}</h3>
          )}
          {embedded}
        </>
      )}
    </div>
  );
}

// Own component so the target lookup (a hook) only runs for panels that actually fall back.
function FallbackScreenPanelTile({
  panel,
  fallback,
  featureName,
  translate,
}: {
  readonly panel: DashboardScreenPanel;
  readonly fallback: string;
  readonly featureName: string;
  readonly translate: Translate;
}): ReactNode {
  const target = useEmbeddedScreen(featureName, fallback);
  if (target === undefined) return null;
  return <EmbeddedScreenPanelTile panel={panel} target={target} translate={translate} />;
}

function ScreenPanelTile({
  panel,
  featureName,
  translate,
}: {
  readonly panel: DashboardScreenPanel;
  readonly featureName: string;
  readonly translate: Translate;
}): ReactNode {
  const visibleWhen = panel.visibleWhen;
  const visibility = useContext(VisibilityQueryContext).get(
    visibleWhen !== undefined ? visibilityGate(visibleWhen.query, NO_GATE_PAYLOAD).key : "",
  );
  const target = useEmbeddedScreen(featureName, panel.screen);
  const verdict = visibleWhen === undefined ? "visible" : evalVisibleWhen(visibleWhen, visibility);
  // Nothing while the gate loads: a fallback that flashes before the real panel flickers.
  if (verdict === "loading") return null;
  if (verdict !== "visible" && panel.fallback !== undefined) {
    return (
      <FallbackScreenPanelTile
        panel={panel}
        fallback={panel.fallback}
        featureName={featureName}
        translate={translate}
      />
    );
  }
  if (target === undefined) return null;
  // A failed gate query must not silently drop the panel: on the
  // account-security page that would hide every MFA enable/disable path.
  if (verdict === "error" && visibility?.error) {
    return (
      <div className={cn("min-w-0", WIDE_PANEL)} data-testid={`dashboard-panel-${panel.id}`}>
        <PanelError
          label={panel.label !== undefined ? translate(panel.label) : panel.id}
          error={visibility.error}
          onRetry={() => void visibility.refetch()}
        />
      </div>
    );
  }
  if (verdict !== "visible") return null;
  return <EmbeddedScreenPanelTile panel={panel} target={target} translate={translate} />;
}

const NO_RECORD_ROW: Readonly<Record<string, unknown>> = {};

function recordTitleText(row: Readonly<Record<string, unknown>> | null, field: string | undefined) {
  if (row === null || field === undefined) return undefined;
  const value = row[field];
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return String(value) === "" ? undefined : String(value);
}

export function WebDashboardBody({
  featureName,
  screen,
  translate,
}: DashboardBodyProps): ReactNode {
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const { Text, Banner, PageHeader, Heading, Button, Dialog, ActionOverflowMenu, Grid } =
    usePrimitives();
  const nav = useNav();
  const headerSlotAvailable = usePageHeaderSlotAvailable();
  const headerCompactContext = usePageHeaderCompact();
  const { formatDateTime } = useDashboardFormats();

  const recordBinding = screen.record;
  const recordId = recordBinding !== undefined ? (nav.searchParams[recordBinding.param] ?? "") : "";
  const recordMissing = recordBinding !== undefined && recordId === "";
  const recordPayloadKey = recordBinding?.payloadKey ?? recordBinding?.param;
  const recordParams: Readonly<Record<string, unknown>> =
    recordPayloadKey !== undefined && recordId !== "" ? { [recordPayloadKey]: recordId } : {};
  const recordQueryName = recordBinding?.query;

  const { params: filterParams, picker } = useFilterParams(screen, !recordMissing);
  const { params: rangeParams, control: rangeControl } = useTimeRange(screen, effectiveTranslate);
  const screenParams: ScreenParams = { filterParams, rangeParams, recordParams };
  const { loadedAtMs, reportLoaded } = useLoadedAt(screenParams);
  const visibilityGates = distinctVisibilityGates(screen.panels, screenParams);
  const gateResults = useVisibilityGateResults();
  const gateKeysSignature = visibilityGates.map((gate) => gate.key).join("\n");
  const gateResultsWithPending = useMemo(
    () =>
      withPendingGates(
        gateResults.results,
        gateKeysSignature === "" ? [] : gateKeysSignature.split("\n"),
      ),
    [gateResults.results, gateKeysSignature],
  );

  // The record query is not a panel query: it needs the interval before the
  // registry context below exists, and `refresh.field` reads from its own row.
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(() =>
    resolveRefreshIntervalMs(screen.refresh, null),
  );
  const recordQuery = useQuery<Readonly<Record<string, unknown>>>(
    recordQueryName ?? "",
    recordParams,
    {
      enabled: recordQueryName !== undefined && !recordMissing,
      live: true,
      ...(refreshIntervalMs !== undefined && { refetchIntervalMs: refreshIntervalMs }),
    },
  );
  const { data: recordRow, refetch: refetchRecord } = recordQuery;
  useEffect(() => {
    setRefreshIntervalMs(resolveRefreshIntervalMs(screen.refresh, recordRow));
  }, [screen.refresh, recordRow]);

  const { register, refetchRegistered } = useRefetchRegistry();
  const queryRuntime = useMemo(
    () => ({ refreshIntervalMs, register }),
    [refreshIntervalMs, register],
  );
  const refetchAll = useCallback(async () => {
    await Promise.all([
      recordQueryName !== undefined ? refetchRecord() : Promise.resolve(),
      refetchRegistered(),
    ]);
  }, [recordQueryName, refetchRecord, refetchRegistered]);

  const [actionError, setActionError] = useState<ErrorNotice | null>(null);
  const idOnlyRow = useMemo(
    () => (recordPayloadKey !== undefined ? { id: recordId, [recordPayloadKey]: recordId } : null),
    [recordId, recordPayloadKey],
  );
  const actionRow = recordQueryName !== undefined ? recordRow : idOnlyRow;
  const headerActions = useRecordActions({
    actions: actionRow !== null && !recordMissing ? screen.actions : undefined,
    record: actionRow ?? NO_RECORD_ROW,
    recordId,
    translate: effectiveTranslate,
    onWriteSuccess: refetchAll,
  });

  const scope = screen.scope;
  // A raw description is agent-facing prose; only an i18n key is user-facing copy.
  const translatedDescription =
    screen.description !== undefined ? effectiveTranslate(screen.description) : undefined;
  const description =
    translatedDescription !== screen.description ? translatedDescription : undefined;
  const scopeBadge =
    scope !== undefined ? (
      <StatusBadge tone="accent" testId={`dashboard-${screen.id}-scope`}>
        {effectiveTranslate(scope.badge)}
      </StatusBadge>
    ) : null;

  if (recordMissing) {
    return (
      <PageSection className="flex flex-col gap-4" testId={`dashboard-${screen.id}`}>
        <Banner variant="info" testId={`dashboard-${screen.id}-record-missing`}>
          {t("kumiko.dashboard.record.missing")}
        </Banner>
      </PageSection>
    );
  }

  const usesPageHeaderSlot = headerSlotAvailable && PageHeader !== undefined;
  const recordTitle = recordTitleText(recordRow, recordBinding?.titleField);
  const headerActionsBar =
    headerActions !== undefined && headerActions.length > 0 ? (
      <Grid columns="auto" testId={`dashboard-${screen.id}-actions`}>
        <HeaderActionsBar
          actions={headerActions}
          Button={Button}
          Dialog={Dialog}
          ActionOverflowMenu={ActionOverflowMenu}
          onError={setActionError}
          collapseAfterPrimary={usesPageHeaderSlot}
          compact={headerCompactContext && usesPageHeaderSlot}
          PageHeader={PageHeader}
          overflowTestId={`dashboard-${screen.id}-actions-overflow`}
        />
      </Grid>
    ) : null;
  // The shell header owns the title; the badge and the actions sit in it there.
  const badgeInHeader = scopeBadge !== null && usesPageHeaderSlot;
  const showPageHeader =
    usesPageHeaderSlot && (badgeInHeader || recordTitle !== undefined || headerActionsBar !== null);
  return (
    <PanelLoadedContext.Provider value={reportLoaded}>
      <DashboardQueryContext.Provider value={queryRuntime}>
        <PageSection className="flex flex-col gap-4" testId={`dashboard-${screen.id}`}>
          {showPageHeader && (
            <PageHeader
              {...(recordTitle !== undefined && { title: recordTitle })}
              {...(badgeInHeader && { status: scopeBadge })}
              {...(headerActionsBar !== null && { actions: headerActionsBar })}
            />
          )}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {!usesPageHeaderSlot && recordTitle !== undefined && (
                <Heading variant="page" testId={`dashboard-${screen.id}-record-title`}>
                  {recordTitle}
                </Heading>
              )}
              {!badgeInHeader && scopeBadge}
              {picker}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {!usesPageHeaderSlot && headerActionsBar}
              {screen.showUpdatedAt !== false && (
                <span
                  data-testid={`dashboard-${screen.id}-updated-at`}
                  className="text-xs tabular-nums text-muted-foreground"
                >
                  {t("kumiko.dashboard.updated-at", { time: formatDateTime(loadedAtMs) })}
                </span>
              )}
              {rangeControl}
            </div>
          </div>
          {actionError !== null && (
            <Banner variant="error" testId="render-edit-action-error">
              {actionError.message}
              <ErrorReference requestId={actionError.requestId} />
            </Banner>
          )}
          {recordQuery.error !== null && recordRow === null && (
            <div
              role="alert"
              data-testid={`dashboard-${screen.id}-record-error`}
              className="flex flex-col items-start gap-2 text-sm"
            >
              <span className="text-status-bad">{dispatcherErrorText(recordQuery.error, t)}</span>
              <Button variant="secondary" onClick={() => void refetchRecord()}>
                {t("kumiko.dashboard.panel.error.retry")}
              </Button>
            </div>
          )}
          {description !== undefined && (
            <Text variant="muted" testId={`dashboard-${screen.id}-description`}>
              {description}
            </Text>
          )}
          {scope?.notice !== undefined && (
            <Banner variant="info" testId={`dashboard-${screen.id}-scope-notice`}>
              {effectiveTranslate(scope.notice)}
            </Banner>
          )}
          <VisibilityQueryContext.Provider value={gateResultsWithPending}>
            <VisibilityGateQueries
              gates={visibilityGates}
              onResult={gateResults.report}
              onForget={gateResults.forget}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {screen.panels.map((panel) => {
                if (panel.kind === "screen") {
                  return (
                    <ScreenPanelTile
                      key={panel.id}
                      panel={panel}
                      featureName={featureName}
                      translate={effectiveTranslate}
                    />
                  );
                }
                const label =
                  panel.kind === "custom" || panel.label === undefined
                    ? undefined
                    : effectiveTranslate(panel.label);
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
                      screenId={screen.id}
                      screenParams={screenParams}
                      translate={effectiveTranslate}
                    />
                  </GatedGridCell>
                );
              })}
            </div>
          </VisibilityQueryContext.Provider>
        </PageSection>
      </DashboardQueryContext.Provider>
    </PanelLoadedContext.Provider>
  );
}
