import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import { resolveRecordTitle } from "../components/render-edit-helpers.tsx";
import { requestLeave } from "../leave-guard.ts";
import type { ErrorNotice } from "./error-reference.tsx";
import { HeaderActionsBar } from "./header-actions-bar.tsx";
import {
  buildMetricItems,
  type DetailHeaderModel,
  renderActionErrorBanner,
  renderBandSubtitle,
  renderHeaderActionsContent,
  renderHeaderSubtitleSlot,
  renderHeaderTitleSlot,
  renderMetricsBlock,
  renderStatusBadge,
} from "./projection-detail-header.tsx";
import { buildDetailTabItems } from "./projection-detail-header-model.ts";

export type DetailRegionModel = DetailHeaderModel & {
  readonly actionError: ErrorNotice | null;
  readonly pageHeaderSlotAvailable: boolean;
  readonly pageHeaderCompactContext: boolean;
  readonly hasHeaderActions: boolean;
  readonly hasMetrics: boolean;
  readonly hasHeaderCard: boolean;
  readonly hasTabs: boolean;
  readonly activeSection:
    | ProjectionDetailScreenDefinition["layout"]["sections"][number]
    | undefined;
};

// Pieces built once per render and shared by the page-header and card layouts.
export type DetailRegionPieces = {
  readonly PageHeader: DetailHeaderModel["primitives"]["PageHeader"];
  readonly pageHeaderCompact: boolean;
  readonly recordTitle: string | undefined;
  readonly headerTitleSlot: ReactNode;
  readonly headerSubtitleSlot: ReactNode;
  readonly headerActionsContent: ReactNode;
  readonly statusBadge: ReactNode;
  readonly bandSubtitle: ReactNode;
  readonly metricItems: ReactNode[] | undefined;
  readonly actionErrorBanner: ReactNode;
};

export function deriveDetailRegionPieces(model: DetailRegionModel): DetailRegionPieces {
  const { screen, record, primitives, actionError, hasHeaderActions } = model;
  // Grouped into the head Card alongside title/status/metrics:
  // these are actions on the record the head shows, not on whichever tab is
  // open, so they must stay in place across tab switches instead of
  // trailing the active tab's content in the card footer.
  const headerActionsContent = hasHeaderActions && renderHeaderActionsContent(model);
  // Rendered as RenderEdit's headerRegion (not as JSX siblings before it) so
  // this shares the same page padding/width as the record's edit card below
  // it, instead of sitting flush against the screen edge (fw record-screen
  // header polish).
  const recordTitle =
    screen.recordTitleField !== undefined
      ? resolveRecordTitle(record[screen.recordTitleField])
      : undefined;
  const headerTitleSlot = renderHeaderTitleSlot(model);
  const headerSubtitleSlot = renderHeaderSubtitleSlot(model);
  const metricItems = buildMetricItems(model);
  const usesPageHeaderSlot = model.pageHeaderSlotAvailable && primitives.PageHeader !== undefined;
  const pageHeaderCompact = model.pageHeaderCompactContext && usesPageHeaderSlot;
  const statusBadge = renderStatusBadge(model);
  const bandSubtitle = renderBandSubtitle(
    model,
    statusBadge,
    headerSubtitleSlot,
    pageHeaderCompact,
  );
  const actionErrorBanner = actionError !== null && renderActionErrorBanner(model, actionError);
  return {
    PageHeader: usesPageHeaderSlot ? primitives.PageHeader : undefined,
    pageHeaderCompact,
    recordTitle,
    headerTitleSlot,
    headerSubtitleSlot,
    headerActionsContent,
    statusBadge,
    bandSubtitle,
    metricItems,
    actionErrorBanner,
  };
}

function renderPageHeaderBranch(
  model: DetailRegionModel,
  pieces: DetailRegionPieces,
  headerSlot: ReactNode | undefined,
  PageHeader: NonNullable<DetailRegionPieces["PageHeader"]>,
): ReactNode {
  const { screen, record, primitives, setActionError, hasHeaderActions, hasMetrics } = model;
  const { Grid, Button, Dialog, ActionOverflowMenu, MetricBand } = primitives;
  const { pageHeaderCompact, recordTitle, statusBadge, bandSubtitle, metricItems } = pieces;
  const header = screen.header;
  return (
    <>
      <PageHeader
        {...(header !== undefined && { title: String(record[header.title] ?? "") })}
        {...(header === undefined && recordTitle !== undefined && { title: recordTitle })}
        {...(!pageHeaderCompact && statusBadge !== undefined && { status: statusBadge })}
        {...(hasHeaderActions && {
          actions: (
            <Grid columns="auto" testId="kumiko-screen-projection-detail-actions">
              <HeaderActionsBar
                actions={model.headerActionsList}
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
                {...(screen.inlineActions !== undefined && {
                  inlineActionIds: screen.inlineActions,
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
        renderMetricsBlock(
          model,
          metricItems,
          bandSubtitle,
          MetricBand !== undefined ? headerSlot : undefined,
        )}
      {pieces.actionErrorBanner}
    </>
  );
}

function renderHeaderCardBranch(
  model: DetailRegionModel,
  pieces: DetailRegionPieces,
  headerSlot: ReactNode | undefined,
): ReactNode {
  const { primitives, hasHeaderActions, hasMetrics, hasHeaderCard } = model;
  const { Card } = primitives;
  const { recordTitle, headerTitleSlot, headerSubtitleSlot, headerActionsContent } = pieces;
  return (
    (hasHeaderCard || headerSlot !== undefined || recordTitle !== undefined) && (
      <Card
        slots={{
          ...(headerTitleSlot !== undefined && { title: headerTitleSlot }),
          ...(headerTitleSlot === undefined && recordTitle !== undefined && { title: recordTitle }),
          ...(headerSubtitleSlot !== undefined && { subtitle: headerSubtitleSlot }),
          ...(headerSlot !== undefined && { headerContent: headerSlot }),
          ...(hasHeaderActions && { headerActions: headerActionsContent }),
        }}
      >
        {hasMetrics && renderMetricsBlock(model, pieces.metricItems)}
        {pieces.actionErrorBanner}
      </Card>
    )
  );
}

function renderDetailTabs(
  model: DetailRegionModel,
  activeSection: NonNullable<DetailRegionModel["activeSection"]>,
  Tabs: NonNullable<DetailHeaderModel["primitives"]["Tabs"]>,
): ReactNode {
  const { screen, record, effectiveTranslate, nav } = model;
  return (
    <Tabs
      testId="kumiko-screen-projection-detail-tabs"
      items={buildDetailTabItems(screen.layout.sections, record, effectiveTranslate)}
      activeId={activeSection.id ?? ""}
      onSelect={(id) => requestLeave(() => nav.setSearchParams({ tab: id }))}
    />
  );
}

export function renderDetailHeaderContent(
  model: DetailRegionModel,
  pieces: DetailRegionPieces,
  headerSlot: ReactNode | undefined,
): ReactNode {
  const { hasTabs, activeSection } = model;
  const { PageHeader } = pieces;
  const { Tabs } = model.primitives;
  return (
    <>
      {PageHeader !== undefined
        ? renderPageHeaderBranch(model, pieces, headerSlot, PageHeader)
        : renderHeaderCardBranch(model, pieces, headerSlot)}
      {hasTabs &&
        activeSection !== undefined &&
        Tabs !== undefined &&
        renderDetailTabs(model, activeSection, Tabs)}
    </>
  );
}
