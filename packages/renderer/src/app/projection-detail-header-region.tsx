import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import { resolveRecordTitle } from "../components/render-edit-helpers.tsx";
import { requestLeave } from "../leave-guard.ts";
import type { ErrorNotice } from "./error-reference.tsx";
import {
  type DetailGuidanceModel,
  renderDetailBreadcrumb,
  renderDetailGuidance,
  wrapLayout,
} from "./projection-detail-guidance.tsx";
import {
  buildMetricItems,
  type DetailHeaderModel,
  renderActionErrorBanner,
  renderBandSubtitle,
  renderHeaderActionsContent,
  renderHeaderSubtitleSlot,
  renderHeaderTitleSlot,
  renderMetricsBlock,
  renderRecordTitleBlock,
  renderStatusBadge,
} from "./projection-detail-header.tsx";
import { buildDetailTabItems } from "./projection-detail-header-model.ts";

export type DetailRegionModel = DetailGuidanceModel & {
  readonly actionError: ErrorNotice | null;
  readonly pageHeaderSlotAvailable: boolean;
  readonly pageHeaderCompactContext: boolean;
  readonly hasHeaderActions: boolean;
  readonly hasMetrics: boolean;
  readonly hasHeaderCard: boolean;
  readonly hasTabs: boolean;
  readonly tabCounts: Readonly<Record<string, number>>;
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

// Tailwind needs the literal class strings.
const NARROW_METRICS_ORDER = "max-md:order-1";
// The split band keeps the padding of the single band: the lead part drops its bottom, the tiles
// part trades its top for the band's gap-3.
const LEAD_BAND_SHARED_PADDING = "[&>*]:pb-0";
const TILES_BAND_SHARED_PADDING = "[&>*]:pt-3";
const NARROW_TABS_ORDER = "max-md:order-2";

function usesNarrowMetricsOrder(model: DetailRegionModel): boolean {
  return model.screen.metricsPlacement?.narrow === "after-guidance";
}

function wrapNarrowOrder(model: DetailRegionModel, orderClass: string, node: ReactNode): ReactNode {
  return usesNarrowMetricsOrder(model) ? wrapLayout(model.primitives, orderClass, node) : node;
}

// Only the metric tiles move below the guidance on narrow screens; the lead and the
// subtitle/status line stay under the title, so they get their own tile-less band.
function renderBandWithNarrowMetrics(
  model: DetailRegionModel,
  metricItems: ReactNode[] | undefined,
  subtitle: ReactNode,
  lead: ReactNode,
): ReactNode {
  const { hasMetrics, primitives } = model;
  const { MetricBand } = primitives;
  if (!usesNarrowMetricsOrder(model) || !hasMetrics) {
    return renderMetricsBlock(model, metricItems, subtitle, lead);
  }
  const splitsBand = MetricBand !== undefined && (subtitle !== undefined || lead !== undefined);
  return (
    <>
      {splitsBand &&
        wrapLayout(
          primitives,
          LEAD_BAND_SHARED_PADDING,
          <MetricBand
            testId="kumiko-screen-projection-detail-metrics-lead"
            subtitle={subtitle}
            {...(lead !== undefined && { lead })}
          >
            {undefined}
          </MetricBand>,
        )}
      {wrapNarrowOrder(
        model,
        splitsBand ? `${NARROW_METRICS_ORDER} ${TILES_BAND_SHARED_PADDING}` : NARROW_METRICS_ORDER,
        renderMetricsBlock(model, metricItems, MetricBand !== undefined ? undefined : subtitle),
      )}
    </>
  );
}

function shortTitleOf(
  header: ProjectionDetailScreenDefinition["header"],
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  const value = header?.shortTitle === undefined ? undefined : record[header.shortTitle];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function renderPageHeaderBranch(
  model: DetailRegionModel,
  pieces: DetailRegionPieces,
  headerSlot: ReactNode | undefined,
  PageHeader: NonNullable<DetailRegionPieces["PageHeader"]>,
): ReactNode {
  const { screen, record, primitives, hasHeaderActions, hasMetrics } = model;
  const { MetricBand } = primitives;
  const { pageHeaderCompact, recordTitle, statusBadge, metricItems } = pieces;
  const header = screen.header;
  // Only an explicit `header` gets the body title block; recordTitleField alone keeps the shell
  // header title and breadcrumb.
  const titleText = header !== undefined ? String(record[header.title] ?? "") : undefined;
  // The title block owns chip and subtitle, so neither the shell header nor the band repeats them.
  const hasTitleBlock = titleText !== undefined;
  const bandSubtitle = hasTitleBlock ? undefined : pieces.bandSubtitle;
  return (
    <>
      <PageHeader
        {...(hasTitleBlock && { bodyTitle: true })}
        {...(hasTitleBlock &&
          !pageHeaderCompact && { recordTitle: shortTitleOf(header, record) ?? titleText })}
        {...(header === undefined && recordTitle !== undefined && { title: recordTitle })}
        {...(!pageHeaderCompact &&
          statusBadge !== undefined && {
            status: statusBadge,
          })}
        {...(hasHeaderActions && {
          actions: renderHeaderActionsContent(model, { compact: pageHeaderCompact, PageHeader }),
        })}
      />
      {titleText !== undefined &&
        renderRecordTitleBlock(
          model,
          titleText,
          statusBadge,
          pieces.headerSubtitleSlot,
          !pageHeaderCompact,
        )}
      {/* The band owns the horizontal inset; the slot is its unstyled lead
          row so it lines up with the metrics below. */}
      {MetricBand === undefined && bandSubtitle}
      {MetricBand === undefined && headerSlot}
      {(hasMetrics || bandSubtitle !== undefined || headerSlot !== undefined) &&
        (MetricBand !== undefined || hasMetrics) &&
        renderBandWithNarrowMetrics(
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
  // Metrics must leave the head card to take part in the narrow reordering.
  const metricsOutsideCard = usesNarrowMetricsOrder(model) && hasMetrics;
  return (
    <>
      {(hasHeaderCard || headerSlot !== undefined || recordTitle !== undefined) && (
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
          {hasMetrics && !metricsOutsideCard && renderMetricsBlock(model, pieces.metricItems)}
          {pieces.actionErrorBanner}
        </Card>
      )}
      {metricsOutsideCard &&
        wrapNarrowOrder(model, NARROW_METRICS_ORDER, renderMetricsBlock(model, pieces.metricItems))}
    </>
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
      items={buildDetailTabItems(
        screen.layout.sections,
        record,
        effectiveTranslate,
        model.tabCounts,
      )}
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
      {renderDetailBreadcrumb(model)}
      {PageHeader !== undefined
        ? renderPageHeaderBranch(model, pieces, headerSlot, PageHeader)
        : renderHeaderCardBranch(model, pieces, headerSlot)}
      {renderDetailGuidance(model)}
      {hasTabs &&
        activeSection !== undefined &&
        Tabs !== undefined &&
        wrapNarrowOrder(model, NARROW_TABS_ORDER, renderDetailTabs(model, activeSection, Tabs))}
    </>
  );
}
