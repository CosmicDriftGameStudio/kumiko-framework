import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { DetailList } from "./detail-list";
import { SectionCard } from "./section-card";

/** Ergebnis-Sektion eines Rechners: SectionCard mit Empty-Zustand (Banner)
 *  oder Kennzahl-Liste (DetailList) + optionalen Extras (Tabelle, Hinweise).
 *  Ersetzt die handgebauten `<dl>`/Banner-Blöcke in Custom-Screens. */
export function ResultPanel({
  title,
  subtitle,
  empty,
  emptyText,
  rows,
  children,
  testId,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly empty?: boolean;
  readonly emptyText?: ReactNode;
  readonly rows?: readonly {
    readonly label: string;
    readonly value: ReactNode;
    readonly emphasize?: boolean;
  }[];
  readonly children?: ReactNode;
  readonly testId?: string;
}): ReactNode {
  const { Banner } = usePrimitives();
  return (
    <SectionCard title={title} subtitle={subtitle} testId={testId}>
      {empty === true ? (
        <Banner variant="info" padded>
          {emptyText}
        </Banner>
      ) : (
        <div className="flex flex-col gap-4">
          {rows !== undefined && rows.length > 0 && <DetailList rows={rows} />}
          {children}
        </div>
      )}
    </SectionCard>
  );
}

export interface ResultColumn<Row> {
  readonly header: string;
  readonly align?: "left" | "right";
  readonly cell: (row: Row) => ReactNode;
}

/** Statische, prop-getriebene Ergebnistabelle für berechnete Zeilen (Tranchen,
 *  Szenarien). Nimmt dem Screen die `<table>`+tabular-nums-Ketten ab.
 *  ponytail: bewusst die minimale Read-only-Tabelle — für Sort/Pager/Facets
 *  stattdessen usePrimitives().DataTable bzw. QueryTable nutzen. */
export function ResultTable<Row>({
  columns,
  rows,
  rowKey,
  testId,
}: {
  readonly columns: readonly ResultColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row, index: number) => string;
  readonly testId?: string;
}): ReactNode {
  return (
    <div className="overflow-x-auto">
      <table data-testid={testId} className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {columns.map((col) => (
              <th
                key={col.header}
                className={cn("py-1.5 font-medium", col.align === "right" && "text-right")}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-b last:border-0">
              {columns.map((col) => (
                <td
                  key={col.header}
                  className={cn("py-1.5", col.align === "right" && "text-right tabular-nums")}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
