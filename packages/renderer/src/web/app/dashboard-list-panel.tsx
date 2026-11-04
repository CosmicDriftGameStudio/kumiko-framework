import type {
  DashboardListFooterLink,
  DashboardListPanel,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import { useNav } from "../../app/nav.tsx";
import { useScreenLinkResolver } from "../../app/reference-link.ts";
import { namedFilterNavigateAllows, navigateTargetAllows } from "../../app/screen-access.ts";
import { hintViewModel } from "../../components/render-list-hint-columns.ts";
import { screenLinkFor } from "../../components/use-render-list-columns.ts";
import type { Translate } from "../../headless/index.ts";
import { useAppFeatures, usePrimitives, useUserRoles } from "../../index.ts";
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

function listSubtitle(
  panel: DashboardListPanel,
  data: ListEnvelope,
  translate: Translate,
): string | undefined {
  const own = panel.subtitle !== undefined ? translate(panel.subtitle) : undefined;
  const total = knownTotal(data);
  if (panel.showTotal !== true || total === undefined) return own;
  const count = translate("kumiko.dashboard.list.shown-of-total", {
    shown: (data.rows ?? []).length,
    total,
  });
  return own === undefined ? count : `${own} · ${count}`;
}

function ListFooter({
  link,
  data,
  translate,
}: {
  readonly link: DashboardListFooterLink;
  readonly data: ListEnvelope;
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
          {translate("kumiko.dashboard.list.more", { count: remaining })}
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

export function ListPanelBody({
  panel,
  label,
  featureName,
  screenParams,
  translate,
}: {
  readonly panel: DashboardListPanel;
  readonly label: string;
  readonly featureName: string;
  readonly screenParams: ScreenParams;
  readonly translate: Translate;
}): ReactNode {
  const { formatPercent, formatNumber, formatDateTime } = useDashboardFormats();
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
      ...(hint !== undefined && { hint: hintViewModel(hint, panel.rowToneField, translate) }),
    };
  });
  const { footerLink } = panel;
  return (
    <QueryPanel<ListEnvelope>
      panel={panel}
      label={label}
      subtitle={
        panel.subtitle === undefined && panel.showTotal !== true
          ? undefined
          : (data) => listSubtitle(panel, data, translate)
      }
      {...(panel.subtitle !== undefined && { staticSubtitle: translate(panel.subtitle) })}
      footer={
        footerLink === undefined
          ? undefined
          : (data) => <ListFooter link={footerLink} data={data} translate={translate} />
      }
      screenParams={screenParams}
      translate={translate}
      skeleton="rows"
      isEmpty={(data) => (data.rows ?? []).length === 0}
    >
      {(data) => (
        <DashboardReferenceListTable
          columns={columns}
          rows={data.rows ?? []}
          featureName={featureName}
          formatPercent={formatPercent}
          formatNumber={formatNumber}
          formatDateTime={formatDateTime}
          translate={translate}
          {...(panel.rowToneField !== undefined && { rowToneField: panel.rowToneField })}
          {...(panel.showHeader !== undefined && { showHeader: panel.showHeader })}
        />
      )}
    </QueryPanel>
  );
}
