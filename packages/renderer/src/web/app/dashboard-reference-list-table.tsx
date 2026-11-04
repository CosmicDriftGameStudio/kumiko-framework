import { parseRefTarget } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ComponentProps, type ReactNode, useMemo } from "react";
import { useReferenceLinkResolver } from "../../app/reference-link.ts";
import { renderReferenceLookupBridges } from "../../components/render-list-reference-bridge.tsx";
import {
  enrichReferenceColumns,
  selectReferenceColumns,
} from "../../components/render-list-reference-columns.ts";
import { useReferenceColumnLookups } from "../../components/use-reference-column-lookups.ts";
import type { ListColumnViewModel, Translate } from "../../headless/index.ts";
import { type DashboardListColumn, DashboardListTable } from "../widgets/dashboard-list.tsx";
import { DashboardListCards } from "../widgets/dashboard-list-cards.tsx";

export type DashboardReferenceTarget = {
  readonly refEntity: string;
  readonly refLabelField?: string;
};

export type DashboardListTableColumn = DashboardListColumn & {
  readonly reference?: DashboardReferenceTarget;
};

type Props = Omit<ComponentProps<typeof DashboardListTable>, "columns"> & {
  readonly columns: readonly DashboardListTableColumn[];
  readonly featureName: string;
  readonly translate: Translate;
  /** Phone layout: one card per row instead of the table. */
  readonly narrowCards?: boolean;
};

function toReferenceViewColumn(
  column: DashboardListTableColumn,
  featureName: string,
): ListColumnViewModel | undefined {
  if (column.reference === undefined) return undefined;
  const target = parseRefTarget(column.reference.refEntity, featureName);
  return {
    field: column.field,
    label: column.label,
    type: "reference",
    sortable: false,
    refEntity: target.entityName,
    refFeature: target.featureName,
    refLabelField: column.reference.refLabelField ?? "id",
  };
}

// Dashboard list rows carry raw ids; reference columns resolve them to the target's label
// the way entity lists do.
export function DashboardReferenceListTable({
  columns,
  rows,
  featureName,
  translate,
  narrowCards = false,
  ...tableProps
}: Props): ReactNode {
  const viewColumns = useMemo(
    () =>
      columns.flatMap((column) => {
        const viewColumn = toReferenceViewColumn(column, featureName);
        return viewColumn === undefined ? [] : [viewColumn];
      }),
    [columns, featureName],
  );
  const referenceColumns = useMemo(
    () => selectReferenceColumns(viewColumns, featureName),
    [viewColumns, featureName],
  );
  const { referenceRequests, handleLookupMap, referenceLookups } = useReferenceColumnLookups(
    rows,
    referenceColumns,
  );
  const resolveReferenceLink = useReferenceLinkResolver();
  const enriched = useMemo(
    () =>
      enrichReferenceColumns({
        columns: viewColumns,
        referenceColumns,
        referenceLookups,
        resolveReferenceLink,
        featureName,
        translate,
      }),
    [viewColumns, referenceColumns, referenceLookups, resolveReferenceLink, featureName, translate],
  );
  const tableColumns = columns.map((column): DashboardListColumn => {
    const enrichedColumn = enriched.find((c) => c.field === column.field);
    const renderer = enrichedColumn?.renderer;
    const { reference: _reference, ...base } = column;
    if (typeof renderer !== "function") return base;
    return {
      ...base,
      renderValue: renderer,
      ...(enrichedColumn?.linkFor !== undefined && { linkFor: enrichedColumn.linkFor }),
    };
  });
  return (
    <>
      {renderReferenceLookupBridges(referenceRequests, handleLookupMap)}
      {narrowCards ? (
        <DashboardListCards
          columns={tableColumns}
          rows={rows}
          translate={translate}
          formatPercent={tableProps.formatPercent}
          formatNumber={tableProps.formatNumber}
          formatDateTime={tableProps.formatDateTime}
          {...(tableProps.testId !== undefined && { testId: tableProps.testId })}
          {...(tableProps.rowToneField !== undefined && { rowToneField: tableProps.rowToneField })}
        />
      ) : (
        <DashboardListTable
          columns={tableColumns}
          rows={rows}
          translate={translate}
          {...tableProps}
        />
      )}
    </>
  );
}
