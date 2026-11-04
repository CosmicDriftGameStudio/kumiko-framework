import type { DashboardListPanel } from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import { useScreenLinkResolver } from "../../app/reference-link.ts";
import { hintViewModel } from "../../components/render-list-hint-columns.ts";
import { screenLinkFor } from "../../components/use-render-list-columns.ts";
import type { Translate } from "../../headless/index.ts";
import {
  type DashboardListTableColumn,
  DashboardReferenceListTable,
} from "./dashboard-reference-list-table.tsx";
import { QueryPanel, type ScreenParams, useDashboardFormats } from "./dashboard-shared.tsx";

type ListEnvelope = { readonly rows?: readonly Readonly<Record<string, unknown>>[] };

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
  return (
    <QueryPanel<ListEnvelope>
      panel={panel}
      label={label}
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
