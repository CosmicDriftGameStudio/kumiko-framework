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
    const renderer = enriched.find((c) => c.field === column.field)?.renderer;
    const { reference: _reference, ...base } = column;
    return typeof renderer === "function" ? { ...base, renderValue: renderer } : base;
  });
  return (
    <>
      {renderReferenceLookupBridges(referenceRequests, handleLookupMap)}
      <DashboardListTable
        columns={tableColumns}
        rows={rows}
        translate={translate}
        {...tableProps}
      />
    </>
  );
}
