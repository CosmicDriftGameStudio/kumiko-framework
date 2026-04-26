import type { EntityDefinition, EntityListScreenDefinition } from "@kumiko/framework/ui-types";
import type { ListRowViewModel, Translate } from "@kumiko/headless";
import { computeListViewModel } from "@kumiko/headless";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";

// RenderList reicht das ListViewModel an die DataTable-Primitive
// weiter und composed optional eine Toolbar (+Neu-Button, Search-
// Filter) sowie einen Empty-State mit CTA.
//
// Search ist client-side: filtert die zugelieferten rows per
// case-insensitive substring-Match auf alle Werte. Server-Filter
// kommt zusammen mit Tier 2.7 (List Filter), wo das auf eine
// Query-Erweiterung umgestellt wird ohne den Caller-Vertrag zu
// brechen — `searchable: true` bleibt das gleiche Flag.

export type RenderListProps = {
  readonly screen: EntityListScreenDefinition;
  readonly entity: EntityDefinition;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly featureName: string;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel) => void;
  /** Override der Default-Empty-Box. Wenn gesetzt, wird der Auto-CTA
   *  via `onCreate` ignoriert — Caller-Inhalt gewinnt. */
  readonly emptyState?: ReactNode;
  /** Setzt einen "+ Neu" Button in die Toolbar UND dient als CTA in
   *  der Default-Empty-Box. Caller liefert die Action selber (z. B.
   *  navigate auf den Edit-Screen). */
  readonly onCreate?: () => void;
  /** Label für den + Neu Button. Default "Neu". Caller kann durch
   *  ein bereits-übersetztes Label ersetzen. */
  readonly createLabel?: string;
  /** Aktiviert ein Search-Input in der Toolbar. Filtert die rows
   *  client-side. */
  readonly searchable?: boolean;
  /** Placeholder für das Search-Input. Default "Suchen…". */
  readonly searchPlaceholder?: string;
};

export function RenderList(props: RenderListProps): ReactNode {
  const {
    screen,
    entity,
    rows,
    featureName,
    translate: translateProp,
    onRowClick,
    emptyState,
    onCreate,
    createLabel = "Neu",
    searchable = false,
    searchPlaceholder = "Suchen…",
  } = props;
  // Wie RenderEdit: Translate-Fallback aus dem i18next-Context, sonst
  // wären Column-Header raw i18n-Keys.
  const t = useTranslation();
  const translate: Translate = translateProp ?? t;
  const { DataTable, Button, Input, Text } = usePrimitives();
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    if (!searchable || search === "") return rows;
    const needle = search.toLowerCase();
    return rows.filter((row) =>
      Object.values(row).some((v) => stringifyForSearch(v).toLowerCase().includes(needle)),
    );
  }, [rows, search, searchable]);

  const vm = useMemo(
    () => computeListViewModel({ screen, entity, rows: filteredRows, translate, featureName }),
    [screen, entity, filteredRows, translate, featureName],
  );

  // Toolbar: Search links (flex-1, expandiert), + Neu rechts. Layout
  // (flex/max-w) lebt in der Web-Primitive — wir reichen nur strukturierte
  // Slots durch, damit Native eigene Anordnung wählen kann.
  const toolbarStart = searchable ? (
    <Input
      kind="text"
      id="render-list-search"
      name="search"
      value={search}
      onChange={setSearch}
      placeholder={searchPlaceholder}
    />
  ) : undefined;

  const toolbarEnd =
    onCreate !== undefined ? (
      <Button variant="primary" onClick={onCreate} testId="render-list-create">
        {`+ ${createLabel}`}
      </Button>
    ) : undefined;

  // Empty-State: Default zeigt Heading + Description + optional CTA-
  // Button. Caller kann via emptyState-Prop komplett überschreiben.
  // Wenn weder onCreate noch ein Override gegeben ist, fällt die
  // DataTable auf "No entries." zurück.
  const composedEmptyState =
    emptyState ??
    (onCreate !== undefined ? (
      <>
        <Text>Noch keine Einträge.</Text>
        <Text variant="small">Lege den ersten an, um loszulegen.</Text>
        <Button variant="primary" onClick={onCreate} testId="render-list-empty-create">
          {`+ ${createLabel}`}
        </Button>
      </>
    ) : undefined);

  // Title-Resolution: ein konventioneller i18n-Key `screen:<id>.title`.
  // Wenn das Bundle den Key kennt, schöner Titel; sonst kommt der
  // screenId selber raus (kein "Untitled"-Fallback — der App-Dev sieht
  // dann dass die Übersetzung fehlt).
  const titleKey = `screen:${screen.id}.title`;
  const resolvedTitle = translate(titleKey);
  const toolbarTitle = resolvedTitle === titleKey ? screen.id : resolvedTitle;

  return (
    <DataTable
      columns={vm.columns}
      rows={vm.rows}
      toolbarTitle={toolbarTitle}
      {...(onRowClick !== undefined && { onRowClick })}
      {...(composedEmptyState !== undefined && { emptyState: composedEmptyState })}
      {...(toolbarStart !== undefined && { toolbarStart })}
      {...(toolbarEnd !== undefined && { toolbarEnd })}
      testId="render-list-table"
    />
  );
}

function stringifyForSearch(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
