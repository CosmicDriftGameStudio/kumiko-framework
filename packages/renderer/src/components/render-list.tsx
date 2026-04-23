import type { EntityDefinition, EntityListScreenDefinition } from "@kumiko/framework/ui-types";
import type { ListRowViewModel, Translate } from "@kumiko/headless";
import { computeListViewModel } from "@kumiko/headless";
import { type ReactNode, useMemo } from "react";
import { usePrimitives } from "../primitives";

// RenderList reicht das ListViewModel direkt an die DataTable-
// Primitive weiter. Die renderCell-Logik (boolean → ✓, field.renderer
// als Function) lebt in der Primitive, nicht hier — so können Custom-
// Implementations andere Formatter einziehen ohne diesen File
// anzufassen.
//
// Sort, pagination, und filter bleiben aus M2 raus. Das ViewModel
// enthält rows wie der Server sie liefert; Query-Params-Wiring kommt
// zusammen mit useQuery-Pagination.

export type RenderListProps = {
  readonly screen: EntityListScreenDefinition;
  readonly entity: EntityDefinition;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly featureName: string;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel) => void;
  readonly emptyState?: ReactNode;
};

const defaultTranslate: Translate = (key) => key;

export function RenderList(props: RenderListProps): ReactNode {
  const {
    screen,
    entity,
    rows,
    featureName,
    translate = defaultTranslate,
    onRowClick,
    emptyState,
  } = props;
  const { DataTable } = usePrimitives();

  const vm = useMemo(
    () => computeListViewModel({ screen, entity, rows, translate, featureName }),
    [screen, entity, rows, translate, featureName],
  );

  return (
    <DataTable
      columns={vm.columns}
      rows={vm.rows}
      {...(onRowClick !== undefined && { onRowClick })}
      {...(emptyState !== undefined && { emptyState })}
      testId="render-list-table"
    />
  );
}
