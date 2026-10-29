import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { type Dispatch, Fragment, type ReactNode, type SetStateAction } from "react";
import type { RenderEditAction } from "../components/render-edit.tsx";
import type { Translate } from "../headless/index.ts";
import type { usePrimitives } from "../primitives.tsx";
import { type ErrorNotice, ErrorReference } from "./error-reference.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { HeaderActionsBar } from "./header-actions-bar.tsx";
import type { NavApi } from "./nav.tsx";
import {
  headerStatusTone,
  resolveHeaderStatusText,
  resolveMetricText,
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
  readonly nav: NavApi;
  readonly appFeatures: readonly FeatureSchema[];
  readonly userRoles: readonly string[] | undefined;
  readonly host: ReturnHost | undefined;
  readonly headerActionsList: readonly RenderEditAction[];
  readonly setActionError: Dispatch<SetStateAction<ErrorNotice | null>>;
};

export function renderHeaderActionsContent(model: DetailHeaderModel): ReactNode {
  const { screen, primitives, headerActionsList, setActionError } = model;
  const { Grid, Button, Dialog, ActionOverflowMenu } = primitives;
  return (
    <Grid columns="auto" testId="kumiko-screen-projection-detail-actions">
      <HeaderActionsBar
        actions={headerActionsList}
        Button={Button}
        Dialog={Dialog}
        ActionOverflowMenu={ActionOverflowMenu}
        onError={setActionError}
        {...(screen.primaryAction !== undefined && { preferredPrimaryId: screen.primaryAction })}
        {...(screen.inlineActions !== undefined && { inlineActionIds: screen.inlineActions })}
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

type SubtitlePartList = ReturnType<typeof buildSubtitleParts>;

function renderSubtitleParts(model: DetailHeaderModel, subtitleParts: SubtitlePartList): ReactNode {
  const { Text, Link } = model.primitives;
  return (
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
  );
}

function renderSubtitleField(model: DetailHeaderModel, subtitleField: string): ReactNode {
  const { screen, record, primitives } = model;
  const { Text, Link } = primitives;
  const subtitleHref = resolveSubtitleHref(screen.header, record);
  return subtitleHref !== undefined ? (
    <Link href={subtitleHref} target="_blank" testId="kumiko-screen-projection-detail-subtitle">
      {String(record[subtitleField] ?? "")}
    </Link>
  ) : (
    <Text variant="muted" testId="kumiko-screen-projection-detail-subtitle">
      {String(record[subtitleField] ?? "")}
    </Text>
  );
}

export function renderHeaderSubtitleSlot(model: DetailHeaderModel): ReactNode {
  const { screen, record, nav, appFeatures, userRoles, host } = model;
  const header = screen.header;
  const subtitleParts =
    header !== undefined && typeof header.subtitle === "object"
      ? buildSubtitleParts(header.subtitle, record, nav, appFeatures, userRoles, host)
      : undefined;
  return subtitleParts !== undefined
    ? subtitleParts.length > 0
      ? renderSubtitleParts(model, subtitleParts)
      : undefined
    : typeof header?.subtitle === "string"
      ? renderSubtitleField(model, header.subtitle)
      : undefined;
}

// slots.header shares the header card with the actions (one card, actions
// top right) instead of rendering as an unframed block above it.
export function buildMetricItems(model: DetailHeaderModel): ReactNode[] | undefined {
  const { screen, record, primitives, effectiveTranslate, nav, appFeatures, userRoles, host } =
    model;
  const { Metric, GridCell, Text } = primitives;
  return screen.metrics?.map((metric) => {
    const field = metric.field;
    const label = effectiveTranslate(metric.label);
    const rawValue = record[field];
    const value = resolveMetricText(metric, rawValue, effectiveTranslate);
    const tiles = screen.metricsStyle === "tiles";
    // Same rule as the dashboard stat panels: a fixed tone must not paint an all-clear 0.
    const tone = rawValue === 0 ? undefined : metric.tone;
    const testId = `kumiko-screen-projection-detail-metric-${field}`;
    const navigate = metric.navigate;
    const onPress =
      navigate !== undefined &&
      metricNavigateResolves(navigate, record) &&
      navigateTargetAllows(navigate, appFeatures, userRoles)
        ? () => runMetricNavigate(nav, navigate, record, host)
        : undefined;
    return Metric !== undefined ? (
      <Metric
        key={field}
        label={label}
        value={value}
        testId={testId}
        {...(onPress !== undefined && { onPress })}
        {...(tiles && { tile: true })}
        {...(tone !== undefined && { tone })}
        {...(metric.icon !== undefined && { icon: metric.icon })}
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
}

// Metrics are a dl band when the primitive exists; the old Grid stays as the fallback.
export function renderMetricsBlock(
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
