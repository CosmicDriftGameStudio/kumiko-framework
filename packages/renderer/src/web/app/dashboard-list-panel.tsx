import type {
  DashboardListFooterLink,
  DashboardListPanel,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useNav } from "../../app/nav.tsx";
import { type ScreenLinkResolver, useScreenLinkResolver } from "../../app/reference-link.ts";
import { namedFilterNavigateAllows, navigateTargetAllows } from "../../app/screen-access.ts";
import { hintViewModel } from "../../components/render-list-hint-columns.ts";
import { screenLinkFor } from "../../components/use-render-list-columns.ts";
import type { CellLink, Translate } from "../../headless/index.ts";
import {
  extensionSectionName,
  useAppFeatures,
  useExtensionSectionComponent,
  usePrimitives,
  useUserRoles,
} from "../../index.ts";
import { useIsBelowSmViewport } from "../primitives/use-narrow-viewport.ts";
import { dashboardNavigationLink } from "./dashboard-navigation-link.ts";
import {
  type DashboardListTableColumn,
  DashboardReferenceListTable,
} from "./dashboard-reference-list-table.tsx";
import { QueryPanel, type ScreenParams, useDashboardFormats } from "./dashboard-shared.tsx";

type ListEnvelope = {
  readonly rows?: readonly Readonly<Record<string, unknown>>[];
  readonly total?: number;
};

function knownTotal(data: ListEnvelope): number | undefined {
  return typeof data.total === "number" && Number.isFinite(data.total) ? data.total : undefined;
}

function limitedEnvelope(data: ListEnvelope, limit: number | undefined): ListEnvelope {
  const rows = data.rows ?? [];
  if (limit === undefined || rows.length <= limit) return data;
  return { rows: rows.slice(0, limit), total: knownTotal(data) ?? rows.length };
}

function listSubtitle(
  panel: DashboardListPanel,
  data: ListEnvelope,
  translate: Translate,
): string | undefined {
  const own = panel.subtitle !== undefined ? translate(panel.subtitle) : undefined;
  const count = totalText(panel, data, false, translate);
  if (count === undefined) return own;
  return own === undefined ? count : `${own} · ${count}`;
}

/** The "{shown} of {total}" text; a `showTotal.text` / `narrowText` replaces the default key. */
function totalText(
  panel: DashboardListPanel,
  data: ListEnvelope,
  narrow: boolean,
  translate: Translate,
): string | undefined {
  const { showTotal } = panel;
  const total = knownTotal(data);
  if (showTotal === undefined || total === undefined) return undefined;
  const custom =
    showTotal === true
      ? undefined
      : narrow
        ? (showTotal.narrowText ?? showTotal.text)
        : showTotal.text;
  return translate(custom ?? "kumiko.dashboard.list.shown-of-total", {
    shown: (data.rows ?? []).length,
    total,
  });
}

function ListFooter({
  link,
  data,
  narrow,
  translate,
}: {
  readonly link: DashboardListFooterLink;
  readonly data: ListEnvelope;
  readonly narrow: boolean;
  readonly translate: Translate;
}): ReactNode {
  const { Link } = usePrimitives();
  const nav = useNav();
  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  const total = knownTotal(data);
  const remaining = total === undefined ? 0 : total - (data.rows ?? []).length;
  const allowed =
    navigateTargetAllows({ screen: link.screen }, appFeatures, userRoles) &&
    namedFilterNavigateAllows(link, appFeatures, userRoles);
  const target = dashboardNavigationLink(nav, link);
  return (
    <>
      {remaining > 0 && (
        <span data-testid="dashboard-list-more">
          {translate(
            (narrow ? (link.narrowMoreText ?? link.moreText) : link.moreText) ??
              "kumiko.dashboard.list.more",
            { count: remaining },
          )}
          {allowed && " · "}
        </span>
      )}
      {allowed && (
        <Link
          href={target.href}
          onPress={target.onPress}
          testId="dashboard-list-footer-link"
          className="font-medium"
        >
          {translate(link.label)}
        </Link>
      )}
    </>
  );
}

function rowLinkResolverOf(
  rowLink: NonNullable<DashboardListPanel["rowLink"]>,
  resolveScreenLink: ScreenLinkResolver,
): (row: Readonly<Record<string, unknown>>) => CellLink | undefined {
  if (rowLink.screenField !== undefined) {
    const link = screenLinkFor(resolveScreenLink, rowLink.screenField, rowLink.paramsField);
    return (row) => link(undefined, row);
  }
  const { paramField, screen } = rowLink;
  return (row) => resolveScreenLink(screen, paramField === undefined ? undefined : row[paramField]);
}

// The same number and date formatting the list cells use, so the phone line agrees with the table.
function lineValueText(
  raw: unknown,
  display: string | undefined,
  formats: Pick<ReturnType<typeof useDashboardFormats>, "formatNumber" | "formatDateTime">,
): string | undefined {
  if (display === "datetime") {
    const atMs =
      typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : Number.NaN;
    return Number.isFinite(atMs) ? formats.formatDateTime(atMs) : undefined;
  }
  if (typeof raw === "number") return formats.formatNumber(raw);
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

function ListLine({
  panel,
  label,
  data,
  link,
  translate,
  screenId,
  screenParams,
}: {
  readonly screenId: string;
  readonly screenParams: ScreenParams;
  readonly panel: DashboardListPanel;
  readonly label: string;
  readonly data: ListEnvelope;
  readonly link: DashboardListFooterLink;
  readonly translate: Translate;
}): ReactNode {
  const { Link } = usePrimitives();
  const nav = useNav();
  const Icon = useExtensionSectionComponent(
    panel.icon !== undefined ? extensionSectionName(panel.icon) : undefined,
  );
  const rows = data.rows ?? [];
  const firstRow = rows[0];
  const columns = panel.columns.map((column) => normalizeListColumn(column));
  const lineField =
    panel.narrow?.field ??
    columns.find(
      (column) => column.display === undefined && typeof firstRow?.[column.field] === "string",
    )?.field;
  const formats = useDashboardFormats();
  const firstText =
    lineField === undefined
      ? undefined
      : lineValueText(
          firstRow?.[lineField],
          columns.find((column) => column.field === lineField)?.display,
          formats,
        );
  const more = (knownTotal(data) ?? rows.length) - 1;
  const target = dashboardNavigationLink(nav, link);
  return (
    <Link
      href={target.href}
      onPress={target.onPress}
      testId={`dashboard-panel-${panel.id}`}
      className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-card-foreground"
    >
      {Icon !== undefined && (
        <span className="flex shrink-0 items-center">
          <Icon
            entityName={screenId}
            entityId={null}
            screenId={screenId}
            filterParams={screenParams.filterParams}
          />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{label}</span>
        {firstText !== undefined && ` · ${firstText}`}
        {more > 0 &&
          ` · ${translate(panel.narrow?.moreText ?? "kumiko.dashboard.list.line-more", { count: more })}`}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function NarrowCardsPanel({
  panel,
  label,
  data,
  columns,
  featureName,
  translate,
}: {
  readonly panel: DashboardListPanel;
  readonly label: string;
  readonly data: ListEnvelope;
  readonly columns: readonly DashboardListTableColumn[];
  readonly featureName: string;
  readonly translate: Translate;
}): ReactNode {
  const { formatPercent, formatNumber, formatDateTime } = useDashboardFormats();
  const { footerLink } = panel;
  const totalLabel = totalText(panel, data, true, translate);
  return (
    <section data-testid={`dashboard-panel-${panel.id}`} className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{label}</h2>
        {totalLabel !== undefined && (
          <span className="text-xs text-muted-foreground">{totalLabel}</span>
        )}
      </header>
      <DashboardReferenceListTable
        columns={columns}
        rows={data.rows ?? []}
        featureName={featureName}
        formatPercent={formatPercent}
        formatNumber={formatNumber}
        formatDateTime={formatDateTime}
        translate={translate}
        narrowCards
        {...(panel.narrow?.titleField !== undefined && { titleField: panel.narrow.titleField })}
        {...(panel.rowToneField !== undefined && { rowToneField: panel.rowToneField })}
      />
      {footerLink !== undefined && (
        <footer className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <ListFooter link={footerLink} data={data} narrow translate={translate} />
        </footer>
      )}
    </section>
  );
}

export function ListPanelBody({
  panel,
  label,
  featureName,
  screenId,
  screenParams,
  translate,
}: {
  readonly panel: DashboardListPanel;
  readonly label: string;
  readonly featureName: string;
  readonly screenId: string;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
}): ReactNode {
  const { formatPercent, formatNumber, formatDateTime } = useDashboardFormats();
  const narrow = useIsBelowSmViewport() ? panel.narrow : undefined;
  const narrowLimit = narrow?.limit;
  const narrowLayout = narrow !== undefined ? (narrow.layout ?? "cards") : undefined;
  const resolveScreenLink = useScreenLinkResolver();
  const columns = panel.columns.map((c): DashboardListTableColumn => {
    const normalized = normalizeListColumn(c);
    const { hint } = normalized;
    return {
      field: normalized.field,
      label: translate(normalized.label ?? normalized.field),
      ...(normalized.display !== undefined && { display: normalized.display }),
      ...(normalized.badgeToneField !== undefined && {
        badgeToneField: normalized.badgeToneField,
      }),
      ...(normalized.badgeDot !== undefined && { badgeDot: normalized.badgeDot }),
      ...(normalized.refEntity !== undefined && {
        reference: {
          refEntity: normalized.refEntity,
          ...(normalized.refLabelField !== undefined && {
            refLabelField: normalized.refLabelField,
          }),
        },
      }),
      ...(normalized.linkScreenField !== undefined && {
        linkFor: screenLinkFor(
          resolveScreenLink,
          normalized.linkScreenField,
          normalized.linkParamsField,
        ),
      }),
      ...(normalized.showOnNarrowOnly === true && { narrowOnly: true as const }),
      ...(hint !== undefined && { hint: hintViewModel(hint, panel.rowToneField, translate) }),
    };
  });
  const { footerLink } = panel;
  return (
    <QueryPanel<ListEnvelope>
      panel={panel}
      label={label}
      subtitle={
        panel.subtitle === undefined && panel.showTotal === undefined
          ? undefined
          : (data) => listSubtitle(panel, limitedEnvelope(data, narrowLimit), translate)
      }
      {...(narrowLayout === "cards" && {
        replaceShell: (data: ListEnvelope) => (
          <NarrowCardsPanel
            panel={panel}
            label={label}
            data={limitedEnvelope(data, narrowLimit)}
            columns={columns}
            featureName={featureName}
            translate={translate}
          />
        ),
      })}
      {...(narrowLayout === "line" &&
        footerLink !== undefined && {
          replaceShell: (data: ListEnvelope) => (
            <ListLine
              panel={panel}
              label={label}
              data={data}
              link={footerLink}
              translate={translate}
              screenId={screenId}
              screenParams={screenParams}
            />
          ),
        })}
      {...(panel.subtitle !== undefined && { staticSubtitle: translate(panel.subtitle) })}
      footer={
        footerLink === undefined || (footerLink.narrowOnly === true && narrow === undefined)
          ? undefined
          : (data) => (
              <ListFooter
                link={footerLink}
                data={limitedEnvelope(data, narrowLimit)}
                narrow={narrow !== undefined}
                translate={translate}
              />
            )
      }
      screenParams={screenParams}
      translate={translate}
      skeleton="rows"
      isEmpty={(data) => (data.rows ?? []).length === 0}
    >
      {(data) => (
        <DashboardReferenceListTable
          columns={columns}
          rows={limitedEnvelope(data, narrowLimit).rows ?? []}
          featureName={featureName}
          formatPercent={formatPercent}
          formatNumber={formatNumber}
          formatDateTime={formatDateTime}
          translate={translate}
          {...(narrowLayout === "cards" && { narrowCards: true })}
          {...(panel.rowLink !== undefined && {
            rowLink: {
              linkFor: rowLinkResolverOf(panel.rowLink, resolveScreenLink),
              icon: panel.rowLink.icon ?? "arrow",
            },
          })}
          {...(panel.rowToneField !== undefined && { rowToneField: panel.rowToneField })}
          {...(panel.rowToneMarker !== undefined && { rowToneMarker: panel.rowToneMarker })}
          {...(panel.showHeader !== undefined && { showHeader: panel.showHeader })}
        />
      )}
    </QueryPanel>
  );
}
