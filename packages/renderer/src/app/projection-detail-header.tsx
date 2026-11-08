import type {
  ProjectionDetailScreenDefinition,
  SelectOptionTone,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { DashboardStatTone } from "@cosmicdrift/kumiko-types/screen";
import { Children, type Dispatch, Fragment, type ReactNode, type SetStateAction } from "react";
import type { RenderEditAction } from "../components/render-edit.tsx";
import type { Translate } from "../headless/index.ts";
import type { usePrimitives } from "../primitives.tsx";
import { isSelectOptionTone } from "../status-tone.ts";
import { type ErrorNotice, ErrorReference } from "./error-reference.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { HeaderActionsBar } from "./header-actions-bar.tsx";
import type { NavApi } from "./nav.tsx";
import {
  formatOrRaw,
  headerStatusTone,
  resolveHeaderStatusText,
  resolveSubtitleHref,
} from "./projection-detail-header-model.ts";
import {
  buildSubtitleParts,
  metricNavigateResolves,
  runMetricNavigate,
} from "./projection-detail-navigation.ts";
import type { ReturnHost } from "./return-to.tsx";
import { navigateTargetAllows } from "./screen-access.ts";

export type DetailHeaderModel = {
  readonly screen: ProjectionDetailScreenDefinition;
  readonly record: Readonly<Record<string, unknown>>;
  readonly primitives: ReturnType<typeof usePrimitives>;
  readonly effectiveTranslate: Translate;
  readonly locale: string;
  readonly nav: NavApi;
  readonly appFeatures: readonly FeatureSchema[];
  readonly userRoles: readonly string[] | undefined;
  readonly host: ReturnHost | undefined;
  readonly headerActionsList: readonly RenderEditAction[];
  readonly setActionError: Dispatch<SetStateAction<ErrorNotice | null>>;
};

export type PageHeaderActionsOptions = {
  readonly compact: boolean;
  readonly PageHeader: ReturnType<typeof usePrimitives>["PageHeader"];
};

export function renderHeaderActionsContent(
  model: DetailHeaderModel,
  pageHeaderOptions?: PageHeaderActionsOptions,
): ReactNode {
  const { screen, primitives, headerActionsList, setActionError } = model;
  const { Grid, Button, Dialog, ActionOverflowMenu } = primitives;
  const menuActionIds = (screen.actions ?? [])
    .filter((action) => action.placement === "menu")
    .map((action) => action.id);
  return (
    <Grid columns="auto" testId="kumiko-screen-projection-detail-actions">
      <HeaderActionsBar
        actions={headerActionsList}
        Button={Button}
        Dialog={Dialog}
        ActionOverflowMenu={ActionOverflowMenu}
        onError={setActionError}
        {...(pageHeaderOptions !== undefined && {
          collapseAfterPrimary: true,
          compact: pageHeaderOptions.compact,
          PageHeader: pageHeaderOptions.PageHeader,
        })}
        {...(screen.primaryAction !== undefined && { preferredPrimaryId: screen.primaryAction })}
        {...(screen.inlineActions !== undefined && { inlineActionIds: screen.inlineActions })}
        {...(menuActionIds.length > 0 && { menuActionIds })}
      />
    </Grid>
  );
}

// Plain Text, not Heading — the Card title slot already renders as its own
// heading element (h3); nesting another heading (h1) inside it is invalid HTML.
export function renderHeaderTitleSlot(model: DetailHeaderModel): ReactNode {
  const { screen, record, primitives } = model;
  const { Grid, Text, StatusBadge } = primitives;
  const header = screen.header;
  const statusText = resolveHeaderStatusText(screen, record, model.effectiveTranslate);
  return header !== undefined ? (
    header.status !== undefined ? (
      <Grid columns="auto">
        <Text testId="kumiko-screen-projection-detail-title">
          {String(record[header.title] ?? "")}
        </Text>
        {StatusBadge !== undefined ? (
          <StatusBadge
            value={statusText}
            tone={headerStatusTone(header, record)}
            testId="kumiko-screen-projection-detail-status"
          />
        ) : (
          <Text testId="kumiko-screen-projection-detail-status">{statusText}</Text>
        )}
      </Grid>
    ) : (
      <Text testId="kumiko-screen-projection-detail-title">
        {String(record[header.title] ?? "")}
      </Text>
    )
  ) : undefined;
}

// Body title block under the breadcrumb: record title (the h1) and the grey subtitle. The status chip sits
// beside it only where the shell bar does not carry it (phone); on desktop the bar shows it.
export function renderRecordTitleBlock(
  model: DetailHeaderModel,
  titleText: string,
  statusBadge: ReactNode,
  subtitle: ReactNode,
  chipInBar: boolean,
): ReactNode {
  const { Grid, Heading, FillContainer } = model.primitives;
  // With a mobileSummary the phone shows only the H1 and that line: chip and subtitle give way.
  const hiddenOnPhone = (node: ReactNode): ReactNode =>
    FillContainer !== undefined && mobileSummaryLineOf(model) !== undefined && node != null ? (
      <FillContainer className="max-sm:hidden">{node}</FillContainer>
    ) : (
      node
    );
  const block = (
    <>
      <Grid columns="auto" testId="kumiko-screen-projection-detail-title-block">
        <Heading variant="page" testId="kumiko-screen-projection-detail-title">
          {titleText}
        </Heading>
        {!chipInBar && hiddenOnPhone(statusBadge)}
      </Grid>
      {hiddenOnPhone(subtitle)}
    </>
  );
  return FillContainer !== undefined ? (
    <FillContainer className="flex flex-col gap-1 px-6 pt-2 max-sm:px-4">{block}</FillContainer>
  ) : (
    block
  );
}

type SubtitlePartList = ReturnType<typeof buildSubtitleParts>;

function renderSubtitleParts(model: DetailHeaderModel, subtitleParts: SubtitlePartList): ReactNode {
  const { Text, Link } = model.primitives;
  return (
    <Text variant="muted" testId="kumiko-screen-projection-detail-subtitle">
      {subtitleParts.map((part, index) => (
        <Fragment key={part.field}>
          {index > 0 && (
            <Text variant="muted" decorative>
              {" · "}
            </Text>
          )}
          {part.prefix !== undefined && (
            <Text testId={`kumiko-screen-projection-detail-subtitle-${part.field}-prefix`}>
              {`${part.prefix} `}
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
  );
}

function renderSubtitleField(
  model: DetailHeaderModel,
  subtitleField: string,
  testId = "kumiko-screen-projection-detail-subtitle",
): ReactNode {
  const { screen, record, primitives } = model;
  const { Text, Link } = primitives;
  const subtitleText = String(record[subtitleField] ?? "");
  if (subtitleText === "") return undefined;
  const subtitleHref = resolveSubtitleHref(screen.header, record);
  return subtitleHref !== undefined ? (
    <Link href={subtitleHref} target="_blank" testId={testId}>
      {subtitleText}
    </Link>
  ) : (
    <Text variant="muted" testId={testId}>
      {subtitleText}
    </Text>
  );
}

export function renderHeaderSubtitleSlot(model: DetailHeaderModel): ReactNode {
  const full = renderFullSubtitle(model);
  const narrowField = model.screen.header?.narrowSubtitle;
  if (narrowField === undefined) return full;
  const narrow = renderSubtitleField(
    model,
    narrowField,
    "kumiko-screen-projection-detail-narrow-subtitle",
  );
  const { FillContainer } = model.primitives;
  if (narrow === undefined || FillContainer === undefined) return full;
  return (
    <>
      {full !== undefined && <FillContainer className="max-sm:hidden">{full}</FillContainer>}
      {narrow !== undefined && <FillContainer className="sm:hidden">{narrow}</FillContainer>}
    </>
  );
}

function renderFullSubtitle(model: DetailHeaderModel): ReactNode {
  const { screen, record, nav, appFeatures, userRoles, host } = model;
  const header = screen.header;
  const subtitleParts =
    header !== undefined && typeof header.subtitle === "object"
      ? buildSubtitleParts(
          header.subtitle,
          record,
          nav,
          appFeatures,
          userRoles,
          host,
          model.effectiveTranslate,
          model.locale,
        )
      : undefined;
  return subtitleParts !== undefined
    ? subtitleParts.length > 0
      ? renderSubtitleParts(model, subtitleParts)
      : undefined
    : typeof header?.subtitle === "string"
      ? renderSubtitleField(model, header.subtitle)
      : undefined;
}

const METRIC_TONE_BY_SELECT_TONE: Readonly<Record<SelectOptionTone, DashboardStatTone>> = {
  ok: "ok",
  warn: "warn",
  bad: "negative",
  critical: "negative",
  accent: "default",
  neutral: "default",
};

function metricFieldTone(
  toneField: string | undefined,
  record: Readonly<Record<string, unknown>>,
): DashboardStatTone | undefined {
  if (toneField === undefined) return undefined;
  const fieldTone = record[toneField];
  return isSelectOptionTone(fieldTone) ? METRIC_TONE_BY_SELECT_TONE[fieldTone] : undefined;
}

function metricSubline(
  subField: string | undefined,
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  const raw = subField === undefined ? undefined : record[subField];
  if (typeof raw === "string") return raw === "" ? undefined : raw;
  return typeof raw === "number" ? String(raw) : undefined;
}

type MetricSpec = NonNullable<DetailHeaderModel["screen"]["metrics"]>[number];

function metricLabel(
  metric: MetricSpec,
  record: Readonly<Record<string, unknown>>,
  translate: DetailHeaderModel["effectiveTranslate"],
): string {
  const fromRecord = metric.labelField === undefined ? undefined : record[metric.labelField];
  return typeof fromRecord === "string" && fromRecord !== "" ? fromRecord : translate(metric.label);
}

function metricPressHandler(
  model: DetailHeaderModel,
  metric: MetricSpec,
): (() => void) | undefined {
  const { record, nav, appFeatures, userRoles, host } = model;
  const navigate = metric.navigate;
  return navigate !== undefined &&
    metricNavigateResolves(navigate, record) &&
    navigateTargetAllows(navigate, appFeatures, userRoles)
    ? () => runMetricNavigate(nav, navigate, record, host)
    : undefined;
}

// Same rule as the dashboard stat panels: a fixed tone must not paint an all-clear 0.
function metricTone(
  metric: MetricSpec,
  record: Readonly<Record<string, unknown>>,
  rawValue: unknown,
): DashboardStatTone | undefined {
  return metricFieldTone(metric.toneField, record) ?? (rawValue === 0 ? undefined : metric.tone);
}

// slots.header shares the header card with the actions (one card, actions
// top right) instead of rendering as an unframed block above it.
export function buildMetricItems(model: DetailHeaderModel): ReactNode[] | undefined {
  const { screen, record, primitives, effectiveTranslate } = model;
  const { Metric, GridCell, Text } = primitives;
  return screen.metrics?.map((metric) => {
    const field = metric.field;
    const label = metricLabel(metric, record, effectiveTranslate);
    const rawValue = record[field];
    const value = formatOrRaw(metric.format, rawValue, effectiveTranslate, model.locale);
    const tiles = screen.metricsStyle === "tiles";
    const tone = metricTone(metric, record, rawValue);
    const sub = metricSubline(metric.subField, record);
    const narrowSub = metricSubline(metric.subFieldNarrow, record);
    const testId = `kumiko-screen-projection-detail-metric-${field}`;
    const onPress = metricPressHandler(model, metric);
    const item =
      Metric !== undefined ? (
        <Metric
          key={field}
          label={label}
          value={value}
          testId={testId}
          {...(onPress !== undefined && { onPress })}
          {...(tiles && { tile: true })}
          {...(tone !== undefined && { tone })}
          {...(metric.icon !== undefined && { icon: metric.icon })}
          {...(sub !== undefined && { sub })}
          {...(narrowSub !== undefined && { narrowSub })}
        />
      ) : (
        <GridCell key={field}>
          <Text variant="small" testId={`${testId}-label`}>
            {label}
          </Text>
          <Text testId={`${testId}-value`}>{value}</Text>
        </GridCell>
      );
    const { FillContainer } = primitives;
    return metric.hideOnNarrow === true && FillContainer !== undefined ? (
      <FillContainer key={field} className="max-sm:hidden">
        {item}
      </FillContainer>
    ) : (
      item
    );
  });
}

// Metrics are a dl band when the primitive exists; the old Grid stays as the fallback.
export function renderMetricsBlock(
  model: DetailHeaderModel,
  metricItems: ReactNode[] | undefined,
  subtitle?: ReactNode,
  lead?: ReactNode,
): ReactNode {
  const { FillContainer } = model.primitives;
  if (mobileSummaryLineOf(model) === undefined || FillContainer === undefined) {
    return renderPlainMetricsBlock(model, metricItems, subtitle, lead);
  }
  // Tiles give way to the summary line (rendered under the title) below sm; display:none keeps one copy for assistive tech.
  const hiddenOnPhone =
    Children.map(metricItems, (item) => (
      <FillContainer className="max-sm:hidden">{item}</FillContainer>
    )) ?? undefined;
  const band = renderPlainMetricsBlock(model, hiddenOnPhone, subtitle, lead);
  return subtitle === undefined && lead === undefined ? (
    <FillContainer className="max-sm:hidden">{band}</FillContainer>
  ) : (
    band
  );
}

function mobileSummaryLineOf(model: DetailHeaderModel): string | undefined {
  const raw =
    model.screen.mobileSummary === undefined ? undefined : model.record[model.screen.mobileSummary];
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

/** The phone-only line right under the title; nothing when the screen has no `mobileSummary` or the field is empty. */
export function renderMobileSummary(model: DetailHeaderModel): ReactNode {
  const { FillContainer, Text } = model.primitives;
  const line = mobileSummaryLineOf(model);
  if (line === undefined || FillContainer === undefined) return undefined;
  return (
    <FillContainer className="px-6 pt-1 text-left sm:hidden max-sm:px-4">
      <Text variant="muted" testId="kumiko-screen-projection-detail-mobile-summary">
        {line}
      </Text>
    </FillContainer>
  );
}

function renderPlainMetricsBlock(
  model: DetailHeaderModel,
  metricItems: ReactNode[] | undefined,
  subtitle?: ReactNode,
  lead?: ReactNode,
): ReactNode {
  const { screen, primitives } = model;
  const { MetricBand, Grid } = primitives;
  return MetricBand !== undefined ? (
    <MetricBand
      testId="kumiko-screen-projection-detail-metrics"
      subtitle={subtitle}
      {...(lead !== undefined && { lead })}
      {...(screen.metricsStyle === "tiles" && { tiles: true })}
    >
      {metricItems}
    </MetricBand>
  ) : (
    <Grid columns={screen.metrics?.length ?? 1} testId="kumiko-screen-projection-detail-metrics">
      {metricItems}
    </Grid>
  );
}

// The phone shell header clips a long status mid-word, so on phones the badge
// sits in the body instead of the shell header slot.
export function renderStatusBadge(model: DetailHeaderModel): ReactNode {
  const { screen, record, primitives } = model;
  const { StatusBadge } = primitives;
  const header = screen.header;
  return header?.status !== undefined && StatusBadge !== undefined ? (
    <StatusBadge
      value={resolveHeaderStatusText(screen, record, model.effectiveTranslate)}
      tone={headerStatusTone(header, record)}
      testId="kumiko-screen-projection-detail-status"
    />
  ) : undefined;
}

// Lives in the band's subtitle row so it shares the metrics' horizontal inset.
export function renderBandSubtitle(
  model: DetailHeaderModel,
  statusBadge: ReactNode,
  headerSubtitleSlot: ReactNode,
  pageHeaderCompact: boolean,
): ReactNode {
  const { Grid } = model.primitives;
  return pageHeaderCompact && statusBadge !== undefined ? (
    <>
      <Grid columns="auto" testId="kumiko-screen-projection-detail-status-row">
        {statusBadge}
      </Grid>
      {headerSubtitleSlot}
    </>
  ) : (
    headerSubtitleSlot
  );
}

export function renderActionErrorBanner(
  model: DetailHeaderModel,
  actionError: ErrorNotice,
): ReactNode {
  const { Banner } = model.primitives;
  return (
    <Banner variant="error" testId="render-edit-action-error">
      {actionError.message}
      <ErrorReference requestId={actionError.requestId} />
    </Banner>
  );
}
