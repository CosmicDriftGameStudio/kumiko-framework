import type {
  MetricNavigate,
  ProjectionDetailScreenDefinition,
  RecordHeaderSubtitlePart,
  RowAction,
  RowActionNavigate,
  RowActionWriteHandler,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { isWriteFormEditSection } from "@cosmicdrift/kumiko-framework/ui-types";
import { resolveActionIcon } from "@cosmicdrift/kumiko-types/action-icon";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { RenderEdit, type RenderEditAction } from "../components/render-edit.tsx";
import { resolveRecordTitle } from "../components/render-edit-helpers.tsx";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import { useUserRoles } from "../context/user-roles-context.tsx";
import type { Translate } from "../headless/index.ts";
import { isSafeHref } from "../headless/index.ts";
import { useQuery } from "../hooks/use-query.ts";
import { useTranslation } from "../i18n.tsx";
import { requestLeave } from "../leave-guard.ts";
import { usePageHeaderCompact, usePageHeaderSlotAvailable } from "../page-header-slot.ts";
import {
  type StatusTone,
  statusToneForOptionTone,
  statusToneForValue,
  usePrimitives,
} from "../primitives.tsx";
import { screenFillsHeight } from "../screen-fills-height.ts";
import { DrawerHost, useDrawerAction } from "./action-form-body.tsx";
import { useAppFeatures } from "./app-features-context.tsx";
import { useClientActionRuntime } from "./client-actions.tsx";
import { type ErrorNotice, ErrorReference } from "./error-reference.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { HeaderActionsBar } from "./header-actions-bar.tsx";
import { type NavApi, type ScreenTarget, useNav } from "./nav.tsx";
import {
  synthesizeProjectionDetailEntity,
  synthesizeProjectionDetailScreen,
} from "./projection-detail-shim.ts";
import { lastSegment } from "./qn.ts";
import { QueryErrorBanner, QueryLoadingBanner } from "./query-state-banners.tsx";
import {
  navigateToReturnOr,
  navigateWithReturnTo,
  type ReturnHost,
  useReturnHost,
  useReturnTarget,
} from "./return-to.tsx";
import { buildRecordActions, refetchAfterWrite, runProjectionRowNavigate } from "./row-actions.ts";
import { findEditScreenFor, navigateTargetAllows } from "./screen-access.ts";
import {
  findEntityListScreen,
  navigateAfterRedirect,
  RecordNotFoundState,
} from "./screen-shared.tsx";

const HEADER_CARD_DEFAULT_WIDTH = "4xl" as const;

// Reuses runProjectionRowNavigate (row-actions.ts) instead of re-deriving
// navigate execution — a metric click has the same entity/screen/params
// shape as a RowActionNavigate, minus the fields (id, label, style) that
// function never reads.
function runMetricNavigate(
  nav: NavApi,
  navigate: MetricNavigate,
  record: Readonly<Record<string, unknown>>,
  host: ReturnHost | undefined,
): void {
  // tab alone (no screen/entity) stays on the current record and just
  // activates that tab — no route change, so runProjectionRowNavigate
  // (which always navigates) doesn't apply here.
  if (navigate.screen === undefined && navigate.entity === undefined) {
    const { tab } = navigate;
    if (tab !== undefined) requestLeave(() => nav.setSearchParams({ tab }));
    return;
  }
  const base = { kind: "navigate" as const, id: "metric-navigate", label: "" };
  const action: RowActionNavigate | undefined =
    navigate.entity !== undefined
      ? {
          ...base,
          entity: navigate.entity,
          ...(navigate.entityId !== undefined && { entityId: navigate.entityId }),
          ...(navigate.params !== undefined && { params: navigate.params }),
          ...(navigate.tab !== undefined && { tab: navigate.tab }),
        }
      : navigate.screen !== undefined
        ? {
            ...base,
            screen: navigate.screen,
            ...(navigate.entityId !== undefined && { entityId: navigate.entityId }),
            ...(navigate.params !== undefined && { params: navigate.params }),
            ...(navigate.tab !== undefined && { tab: navigate.tab }),
          }
        : undefined;
  if (action === undefined) return;
  runProjectionRowNavigate(nav, action, { id: "", values: record }, host);
}

// Absolute http(s) check for RecordHeaderSpec.subtitleHref — deliberately
// stricter than isSafeHref (which also allows relative paths and mailto:),
// since a relative/mailto value here should render as plain text, not a
// "_blank" external link.
function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) && isSafeHref(value);
}

type SubtitlePartView = {
  readonly field: string;
  readonly text: string;
  readonly href?: string;
  readonly onPress?: () => void;
};

// hrefFor throws for an entity without a detailFor screen; outside
// createKumikoApp the feature list is empty, so navigateTargetAllows can't
// rule that out beforehand. The NavApi owns target resolution, so asking it
// and falling back to plain text covers both cases.
function hrefForNavigate(
  nav: NavApi,
  navigate: MetricNavigate,
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  const entityId =
    navigate.entityId !== undefined ? String(record[navigate.entityId] ?? "") : undefined;
  try {
    if (navigate.entity !== undefined) {
      return entityId === undefined || entityId === ""
        ? undefined
        : nav.hrefFor({ entity: navigate.entity, id: entityId });
    }
    if (navigate.screen !== undefined) {
      return nav.hrefFor({
        screenId: navigate.screen,
        ...(entityId !== undefined && entityId !== "" && { entityId }),
      });
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function buildSubtitleParts(
  parts: readonly RecordHeaderSubtitlePart[],
  record: Readonly<Record<string, unknown>>,
  nav: NavApi,
  appFeatures: readonly FeatureSchema[],
  userRoles: readonly string[] | undefined,
  host: ReturnHost | undefined,
): SubtitlePartView[] {
  return parts.flatMap((part): SubtitlePartView[] => {
    const field = typeof part === "string" ? part : part.field;
    const text = String(record[field] ?? "");
    if (text === "") return [];
    const navigate = typeof part === "string" ? undefined : part.navigate;
    if (navigate === undefined || !navigateTargetAllows(navigate, appFeatures, userRoles)) {
      return [{ field, text }];
    }
    const href = hrefForNavigate(nav, navigate, record);
    if (href === undefined) return [{ field, text }];
    return [{ field, text, href, onPress: () => runMetricNavigate(nav, navigate, record, host) }];
  });
}

function headerStatusTone(
  header: NonNullable<ProjectionDetailScreenDefinition["header"]>,
  record: Readonly<Record<string, unknown>>,
): StatusTone | undefined {
  if (header.status === undefined) return undefined;
  const value = String(record[header.statusToneField ?? header.status] ?? "");
  const declared =
    header.statusTones !== undefined && Object.hasOwn(header.statusTones, value)
      ? header.statusTones[value]
      : undefined;
  const declaredTone = declared !== undefined ? statusToneForOptionTone(declared) : undefined;
  return declaredTone ?? statusToneForValue(value);
}

function resolveSubtitleHref(
  header: ProjectionDetailScreenDefinition["header"],
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  if (header?.subtitleHref === undefined) return undefined;
  const value = record[header.subtitleHref];
  return typeof value === "string" && isAbsoluteHttpUrl(value) ? value : undefined;
}

// Projection detail body: read-only single-row inspector over an explicit
// query instead of an entity (see projection-detail-shim.ts for the debt
// doc). Fetches itself via `screen.query` + `idParam` (like
// EntityEditUpdateBody, which derives the query QN from the entity
// convention; here the QN is author-explicit, as with ProjectionListBody).
// Renders through RenderEdit WITH a no-op customSubmit instead of a
// writeCommand: hasEditableSection() hides the save button (every field is
// readOnly), and even a native form submit (Enter keypress) would throw
// against controller.submit() without a submit config if there were no
// customSubmit; the no-op makes that path harmless instead of leaving it to
// chance.
export function ProjectionDetailBody({
  schema,
  screen,
  translate,
  entityId,
}: {
  readonly schema: FeatureSchema;
  // detailFor sits on the ScreenDefinition intersection, not on the
  // projectionDetail variant itself (screen.ts:832) — widen the prop type
  // to keep reading it here instead of re-deriving it from schema.screens.
  readonly screen: ProjectionDetailScreenDefinition & { readonly detailFor?: string };
  readonly translate?: Translate;
  readonly entityId?: string;
}): ReactNode {
  const {
    Banner,
    Button,
    Dialog,
    Text,
    Grid,
    GridCell,
    Card,
    Tabs,
    StatusBadge,
    Metric,
    MetricBand,
    PageHeader,
    Link,
    ActionOverflowMenu,
  } = usePrimitives();
  const t = useTranslation();
  const pageHeaderSlotAvailable = usePageHeaderSlotAvailable();
  const pageHeaderCompactContext = usePageHeaderCompact();
  const effectiveTranslate = translate ?? t;
  const nav = useNav();
  const idParam = screen.idParam ?? "id";
  // Singleton screens ignore whatever id the path happens to carry — the
  // server picks the row from session/context, so forwarding a path id
  // (even a stray/spoofed one) into the query or into extension sections'
  // entityId fallback (resolveExtensionEntityId in render-edit.tsx) would
  // let a client-controlled value leak where none is meant to reach.
  const effectiveEntityId = screen.singleton === true ? undefined : entityId;
  const isTabsMode = screen.layout.mode === "tabs";
  const activeSection = useMemo(() => {
    if (!isTabsMode || Tabs === undefined) return undefined;
    const tabParam = nav.searchParams["tab"];
    return (
      screen.layout.sections.find((section) => section.id === tabParam) ?? screen.layout.sections[0]
    );
  }, [isTabsMode, Tabs, screen.layout.sections, nav.searchParams]);
  const hasTabs = isTabsMode && Tabs !== undefined && activeSection !== undefined;
  // Tabs is an optional Core-Primitive: without it the screen falls back to
  // the stacked all-sections layout instead of silently truncating to section 1.
  useEffect(() => {
    if (isTabsMode && Tabs === undefined) {
      // biome-ignore lint/suspicious/noConsole: dev-warning for a setup error
      console.warn(
        `[kumiko] screen "${screen.id}" uses layout.mode: "tabs", but no <Tabs> primitive is registered — the tab strip will not render. createKumikoApp() from kumiko-renderer-web wires it automatically.`,
      );
    }
  }, [isTabsMode, Tabs, screen.id]);
  const entity = useMemo(() => synthesizeProjectionDetailEntity(screen.layout), [screen.layout]);
  const detailScreen = useMemo(() => {
    const source =
      activeSection !== undefined
        ? { ...screen, layout: { ...screen.layout, sections: [activeSection] } }
        : screen;
    return synthesizeProjectionDetailScreen(source);
  }, [screen, activeSection]);
  const detailQuery = useQuery<Readonly<Record<string, unknown>>>(
    screen.query,
    effectiveEntityId !== undefined ? { [idParam]: effectiveEntityId } : {},
  );

  // A writeForm section's handler creates a new record (see EditWriteFormSection's
  // doc) — both the outer record (header/metrics/other sections) and a sibling
  // relatedList section's own independently-fetched rows must reflect it. A
  // query refetch alone only refreshes `record` below; bumping this as
  // <RenderEdit>'s refreshToken makes RelatedListSection's own useQuery
  // re-run too (it has no `live` subscription of its own). Refetch instead of
  // remount (a `key`) so unsaved input in the other writeForm sections and
  // the related lists' local state survive.
  const [reloadNonce, setReloadNonce] = useState(0);
  const reloadDetail = useCallback(async () => {
    await refetchAfterWrite(detailQuery.refetch);
    setReloadNonce((n) => n + 1);
  }, [detailQuery.refetch]);

  // Header actions render directly via RenderEditActionButton (fw#2713,
  // headerActions moved out of RenderEdit's footer) — this component owns
  // the failure-surfacing state RenderEdit used to own for them.
  const [actionError, setActionError] = useState<ErrorNotice | null>(null);

  // Default edit action (fw#2166): resolved cross-feature over ALL mounted
  // features, not just this feature's own schema — detailFor itself is
  // resolved cross-feature by the boot-validator (detail-screens.ts), and
  // the motivating case is a projectionDetail whose query belongs to one
  // feature while the entity's entityEdit screen lives in another. Unlike
  // useNavigateToCreateFor this must NOT filter on allowCreate/singleton —
  // those gate create-targets, we're resolving an update-target by a
  // known id.
  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  const dispatcher = useOptionalDispatcher();
  const clientActions = useClientActionRuntime();
  const host = useReturnHost();
  const returnTargetParam = useReturnTarget(screen.id);
  // A singleton has no record route to come back to — same as entityEdit.
  const returnTarget = screen.singleton === true ? undefined : returnTargetParam;
  const { drawerAction, drawerScreen, drawerInitialValues, openDrawer, closeDrawer } =
    useDrawerAction(schema);
  const handleRecordLeft = useCallback(
    (action: RowActionWriteHandler, resultData: unknown, deletedShownRecord: boolean) => {
      const record = detailQuery.data ?? {};
      // Never return onto the just-deleted record.
      const target =
        deletedShownRecord && returnTarget?.entityId === effectiveEntityId
          ? undefined
          : returnTarget;
      if (action.redirect !== undefined) {
        navigateAfterRedirect({
          nav,
          schema,
          appFeatures,
          returnTarget: target,
          redirect: action.redirect,
          resultData,
          record,
        });
        return;
      }
      navigateToReturnOr(nav, target, () => {
        const listScreen =
          screen.listScreenId ??
          (screen.detailFor !== undefined
            ? findEntityListScreen(schema, screen.detailFor)?.id
            : undefined);
        if (listScreen !== undefined) nav.navigate({ screenId: lastSegment(listScreen) });
        else void detailQuery.refetch();
      });
    },
    [
      detailQuery.data,
      detailQuery.refetch,
      nav,
      schema,
      appFeatures,
      returnTarget,
      effectiveEntityId,
      screen.listScreenId,
      screen.detailFor,
    ],
  );
  const editScreen = useMemo(() => {
    const detailFor = screen.detailFor;
    if (detailFor === undefined) return undefined;
    return findEditScreenFor(detailFor, appFeatures, userRoles);
  }, [appFeatures, screen.detailFor, userRoles]);
  const defaultEditAction = useMemo((): RenderEditAction | undefined => {
    if (editScreen === undefined) return undefined;
    // editScreen.id is registry-qualified ("feature:screen:contact-edit");
    // nav.navigate expects the short form (see useNavigateToCreateFor above).
    const targetScreenId = lastSegment(editScreen.id);
    return {
      id: "edit",
      label: effectiveTranslate("kumiko.actions.edit"),
      icon: resolveActionIcon("edit"),
      onPress: () => {
        const target: ScreenTarget = {
          screenId: targetScreenId,
          ...(effectiveEntityId !== undefined && { entityId: effectiveEntityId }),
        };
        navigateWithReturnTo(nav, target, host);
      },
    };
  }, [editScreen, effectiveTranslate, nav, effectiveEntityId, host]);

  // a navigate-screen action targeting an entityEdit screen for the
  // SAME entity this projectionDetail shows (screen.detailFor) defaults its
  // entityId to the shown record's own id — without this fallback the target
  // opens an empty create-form instead of the shown record, silently.
  // Searched cross-feature, consistent with editScreen above.
  const sameEntityScreenId = useCallback(
    (targetScreen: string): string | undefined => {
      const record = detailQuery.data ?? {};
      const targetIsEntityEditSameEntity =
        screen.detailFor !== undefined &&
        appFeatures.some((feature) =>
          feature.screens.some(
            (s) =>
              s.type === "entityEdit" &&
              s.entity === screen.detailFor &&
              lastSegment(s.id) === targetScreen,
          ),
        );
      return targetIsEntityEditSameEntity ? String(record["id"] ?? "") : undefined;
    },
    [detailQuery.data, screen.detailFor, appFeatures],
  );
  const buildSectionActions = useCallback(
    (actions: readonly RowAction[]): readonly RenderEditAction[] | undefined =>
      buildRecordActions({
        actions,
        record: detailQuery.data ?? {},
        translate: effectiveTranslate,
        nav,
        host,
        dispatcher,
        openDrawer,
        onWriteSuccess: reloadDetail,
        onRecordLeft: handleRecordLeft,
        sameEntityScreenId,
        clientActions,
      }),
    [
      detailQuery.data,
      reloadDetail,
      effectiveTranslate,
      nav,
      host,
      dispatcher,
      clientActions,
      openDrawer,
      handleRecordLeft,
      sameEntityScreenId,
    ],
  );
  const headerActions = useMemo((): readonly RenderEditAction[] | undefined => {
    const declaredHasEdit = screen.actions?.some((a) => a.id === "edit") === true;
    const resolved = buildRecordActions({
      actions: screen.actions ?? [],
      record: detailQuery.data ?? {},
      translate: effectiveTranslate,
      nav,
      host,
      dispatcher,
      openDrawer,
      onWriteSuccess: reloadDetail,
      onRecordLeft: handleRecordLeft,
      sameEntityScreenId,
      clientActions,
    });
    if (defaultEditAction === undefined || declaredHasEdit) return resolved;
    return [defaultEditAction, ...(resolved ?? [])];
  }, [
    screen.actions,
    defaultEditAction,
    effectiveTranslate,
    nav,
    host,
    dispatcher,
    clientActions,
    detailQuery.data,
    reloadDetail,
    openDrawer,
    handleRecordLeft,
    sameEntityScreenId,
  ]);
  const hasHeader = screen.header !== undefined;
  const hasMetrics = screen.metrics !== undefined && screen.metrics.length > 0;
  // ?? [] rather than threading `headerActions !== undefined` through every
  // use below — an empty array is a safe no-op for .map/.length.
  const headerActionsList = headerActions ?? [];
  const hasHeaderActions = headerActionsList.length > 0;
  const hasHeaderCard = hasHeader || hasMetrics || hasHeaderActions;
  // A header card (metric band, status, actions) needs more room than the
  // 640px form column; screens with only a record title keep the narrow one.
  const widensScreenFormColumn =
    hasHeaderCard &&
    !hasTabs &&
    screenFillsHeight(screen) &&
    detailScreen.layout.width === undefined;
  const renderedDetailScreen = useMemo(
    () =>
      widensScreenFormColumn
        ? { ...detailScreen, layout: { ...detailScreen.layout, width: HEADER_CARD_DEFAULT_WIDTH } }
        : detailScreen,
    [detailScreen, widensScreenFormColumn],
  );

  if (effectiveEntityId === undefined && screen.singleton !== true) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-projection-detail-missing-id">
        Screen <Text variant="code">{screen.id}</Text> (projectionDetail) needs a row id in the path
        — open it from a row action.
      </Banner>
    );
  }
  if (detailQuery.loading && detailQuery.data === null) {
    return <QueryLoadingBanner />;
  }
  if (detailQuery.error && detailQuery.data === null) {
    return (
      <QueryErrorBanner
        error={detailQuery.error}
        translate={effectiveTranslate}
        onRetry={detailQuery.refetch}
      />
    );
  }
  // A failed refetch keeps the last good record on screen.
  const refetchErrorBanner = detailQuery.error ? (
    <QueryErrorBanner
      error={detailQuery.error}
      translate={effectiveTranslate}
      onRetry={detailQuery.refetch}
    />
  ) : null;
  const record = detailQuery.data;
  if (!record) {
    const backListScreen =
      screen.listScreenId ??
      (screen.detailFor !== undefined
        ? findEntityListScreen(schema, screen.detailFor)?.id
        : undefined);
    return (
      <RecordNotFoundState
        translate={effectiveTranslate}
        {...((returnTarget !== undefined || backListScreen !== undefined) && {
          onBack: () =>
            navigateToReturnOr(nav, returnTarget, () => {
              if (backListScreen !== undefined) {
                nav.navigate({ screenId: lastSegment(backListScreen) });
              }
            }),
        })}
      />
    );
  }
  // Grouped into the head Card alongside title/status/metrics (fw#2713):
  // these are actions on the record the head shows, not on whichever tab is
  // open, so they must stay in place across tab switches instead of
  // trailing the active tab's content in the card footer.
  const headerActionsContent = hasHeaderActions && (
    <Grid columns="auto" testId="kumiko-screen-projection-detail-actions">
      <HeaderActionsBar
        actions={headerActionsList}
        Button={Button}
        Dialog={Dialog}
        ActionOverflowMenu={ActionOverflowMenu}
        onError={setActionError}
        {...(screen.primaryAction !== undefined && { preferredPrimaryId: screen.primaryAction })}
      />
    </Grid>
  );
  // Rendered as RenderEdit's headerRegion (not as JSX siblings before it) so
  // this shares the same page padding/width as the record's edit card below
  // it, instead of sitting flush against the screen edge (fw record-screen
  // header polish).
  const recordTitle =
    screen.recordTitleField !== undefined
      ? resolveRecordTitle(record[screen.recordTitleField])
      : undefined;
  const header = screen.header;
  const subtitleHref = resolveSubtitleHref(header, record);
  // Plain Text, not Heading — the Card title slot already renders as its own
  // heading element (h3); nesting another heading (h1) inside it is invalid HTML.
  const headerTitleSlot =
    header !== undefined ? (
      header.status !== undefined ? (
        <Grid columns="auto">
          <Text testId="kumiko-screen-projection-detail-title">
            {String(record[header.title] ?? "")}
          </Text>
          {StatusBadge !== undefined ? (
            <StatusBadge
              value={String(record[header.status] ?? "")}
              tone={headerStatusTone(header, record)}
              testId="kumiko-screen-projection-detail-status"
            />
          ) : (
            <Text testId="kumiko-screen-projection-detail-status">
              {String(record[header.status] ?? "")}
            </Text>
          )}
        </Grid>
      ) : (
        <Text testId="kumiko-screen-projection-detail-title">
          {String(record[header.title] ?? "")}
        </Text>
      )
    ) : undefined;
  const subtitleParts =
    header !== undefined && typeof header.subtitle === "object"
      ? buildSubtitleParts(header.subtitle, record, nav, appFeatures, userRoles, host)
      : undefined;
  const headerSubtitleSlot =
    subtitleParts !== undefined ? (
      subtitleParts.length > 0 ? (
        <Text testId="kumiko-screen-projection-detail-subtitle">
          {subtitleParts.map((part, index) => (
            <Fragment key={part.field}>
              {index > 0 && (
                <Text variant="muted" decorative>
                  {" · "}
                </Text>
              )}
              {part.href !== undefined ? (
                <Link
                  href={part.href}
                  {...(part.onPress !== undefined && { onPress: part.onPress })}
                  className="underline"
                  testId={`kumiko-screen-projection-detail-subtitle-${part.field}`}
                >
                  {part.text}
                </Link>
              ) : (
                <Text testId={`kumiko-screen-projection-detail-subtitle-${part.field}`}>
                  {part.text}
                </Text>
              )}
            </Fragment>
          ))}
        </Text>
      ) : undefined
    ) : typeof header?.subtitle === "string" ? (
      subtitleHref !== undefined ? (
        <Link href={subtitleHref} target="_blank" testId="kumiko-screen-projection-detail-subtitle">
          {String(record[header.subtitle] ?? "")}
        </Link>
      ) : (
        <Text variant="muted" testId="kumiko-screen-projection-detail-subtitle">
          {String(record[header.subtitle] ?? "")}
        </Text>
      )
    ) : undefined;
  // slots.header shares the header card with the actions (one card, actions
  // top right) instead of rendering as an unframed block above it.
  const metricItems = screen.metrics?.map((metric) => {
    const field = metric.field;
    const label = effectiveTranslate(metric.label);
    const value = String(record[field] ?? "");
    const testId = `kumiko-screen-projection-detail-metric-${field}`;
    const navigate = metric.navigate;
    const onPress =
      navigate !== undefined && navigateTargetAllows(navigate, appFeatures, userRoles)
        ? () => runMetricNavigate(nav, navigate, record, host)
        : undefined;
    return Metric !== undefined ? (
      <Metric
        key={field}
        label={label}
        value={value}
        testId={testId}
        {...(onPress !== undefined && { onPress })}
      />
    ) : (
      <GridCell key={field}>
        <Text variant="small" testId={`${testId}-label`}>
          {label}
        </Text>
        <Text testId={`${testId}-value`}>{value}</Text>
      </GridCell>
    );
  });
  // Metrics are a dl band when the primitive exists; the old Grid stays as the fallback.
  const metricsBlock = (subtitle?: ReactNode, lead?: ReactNode): ReactNode =>
    MetricBand !== undefined ? (
      <MetricBand
        testId="kumiko-screen-projection-detail-metrics"
        subtitle={subtitle}
        {...(lead !== undefined && { lead })}
      >
        {metricItems}
      </MetricBand>
    ) : (
      <Grid columns={screen.metrics?.length ?? 1} testId="kumiko-screen-projection-detail-metrics">
        {metricItems}
      </Grid>
    );
  const usesPageHeaderSlot = pageHeaderSlotAvailable && PageHeader !== undefined;
  const pageHeaderCompact = pageHeaderCompactContext && usesPageHeaderSlot;
  // The phone shell header clips a long status mid-word, so on phones the badge
  // sits in the body instead of the shell header slot.
  const statusBadge =
    header?.status !== undefined && StatusBadge !== undefined ? (
      <StatusBadge
        value={String(record[header.status] ?? "")}
        tone={headerStatusTone(header, record)}
        testId="kumiko-screen-projection-detail-status"
      />
    ) : undefined;
  // Lives in the band's subtitle row so it shares the metrics' horizontal inset.
  const bandSubtitle =
    pageHeaderCompact && statusBadge !== undefined ? (
      <>
        <Grid columns="auto" testId="kumiko-screen-projection-detail-status-row">
          {statusBadge}
        </Grid>
        {headerSubtitleSlot}
      </>
    ) : (
      headerSubtitleSlot
    );
  const actionErrorBanner = actionError !== null && (
    <Banner variant="error" testId="render-edit-action-error">
      {actionError.message}
      <ErrorReference requestId={actionError.requestId} />
    </Banner>
  );
  const renderHeaderContent = (headerSlot: ReactNode | undefined): ReactNode => (
    <>
      {usesPageHeaderSlot ? (
        <>
          <PageHeader
            {...(header !== undefined && { title: String(record[header.title] ?? "") })}
            {...(header === undefined && recordTitle !== undefined && { title: recordTitle })}
            {...(!pageHeaderCompact && statusBadge !== undefined && { status: statusBadge })}
            {...(hasHeaderActions && {
              actions: (
                <Grid columns="auto" testId="kumiko-screen-projection-detail-actions">
                  <HeaderActionsBar
                    actions={headerActionsList}
                    Button={Button}
                    Dialog={Dialog}
                    ActionOverflowMenu={ActionOverflowMenu}
                    onError={setActionError}
                    collapseAfterPrimary
                    compact={pageHeaderCompact}
                    PageHeader={PageHeader}
                    {...(screen.primaryAction !== undefined && {
                      preferredPrimaryId: screen.primaryAction,
                    })}
                  />
                </Grid>
              ),
            })}
          />
          {/* The band owns the horizontal inset; the slot is its unstyled lead
              row so it lines up with the metrics below. */}
          {MetricBand === undefined && bandSubtitle}
          {MetricBand === undefined && headerSlot}
          {(hasMetrics || bandSubtitle !== undefined || headerSlot !== undefined) &&
            (MetricBand !== undefined || hasMetrics) &&
            metricsBlock(bandSubtitle, MetricBand !== undefined ? headerSlot : undefined)}
          {actionErrorBanner}
        </>
      ) : (
        (hasHeaderCard || headerSlot !== undefined || recordTitle !== undefined) && (
          <Card
            slots={{
              ...(headerTitleSlot !== undefined && { title: headerTitleSlot }),
              ...(headerTitleSlot === undefined &&
                recordTitle !== undefined && { title: recordTitle }),
              ...(headerSubtitleSlot !== undefined && { subtitle: headerSubtitleSlot }),
              ...(headerSlot !== undefined && { headerContent: headerSlot }),
              ...(hasHeaderActions && { headerActions: headerActionsContent }),
            }}
          >
            {hasMetrics && metricsBlock()}
            {actionErrorBanner}
          </Card>
        )
      )}
      {hasTabs && activeSection !== undefined && (
        <Tabs
          testId="kumiko-screen-projection-detail-tabs"
          items={screen.layout.sections.map((section) => {
            const countField = isWriteFormEditSection(section) ? undefined : section.countField;
            const countValue = countField !== undefined ? record[countField] : undefined;
            const count =
              typeof countValue === "number" && Number.isFinite(countValue)
                ? countValue
                : undefined;
            return {
              id: section.id ?? "",
              label: effectiveTranslate(section.title ?? section.id ?? ""),
              ...(count !== undefined && { count }),
            };
          })}
          activeId={activeSection.id ?? ""}
          onSelect={(id) => requestLeave(() => nav.setSearchParams({ tab: id }))}
        />
      )}
    </>
  );
  return (
    <>
      {refetchErrorBanner}
      <RenderEdit
        key={entityId}
        refreshToken={reloadNonce}
        screen={renderedDetailScreen}
        entity={entity}
        featureName={schema.featureName}
        initial={record}
        entityId={effectiveEntityId}
        customSubmit={async () => ({ isSuccess: true, validationBlocked: false, data: undefined })}
        onReload={reloadDetail}
        onRelatedListDrawerAction={openDrawer}
        {...(translate !== undefined && { translate })}
        {...(hasTabs && { hideSectionTitles: true })}
        {...(screenFillsHeight(screen) && { fillScreenHeight: true })}
        {...((hasHeaderCard ||
          hasTabs ||
          screen.slots?.header !== undefined ||
          screen.recordTitleField !== undefined) && {
          headerRegion: renderHeaderContent,
        })}
        buildSectionActions={buildSectionActions}
        valueDisplay={screen.valueDisplay ?? "text"}
      />
      <DrawerHost
        schema={schema}
        drawerAction={drawerAction}
        drawerScreen={drawerScreen}
        {...(drawerInitialValues !== undefined && { drawerInitialValues })}
        userRoles={userRoles}
        {...(translate !== undefined && { translate })}
        onClose={closeDrawer}
        onSuccess={() => {
          closeDrawer();
          void reloadDetail();
        }}
      />
    </>
  );
}
