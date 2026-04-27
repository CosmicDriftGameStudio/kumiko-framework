import type { EntityDefinition, EntityListScreenDefinition } from "@kumiko/framework/ui-types";
import type { ListRowViewModel, Translate } from "@kumiko/headless";
import { computeListViewModel } from "@kumiko/headless";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { ListSort } from "../hooks/use-list-url-state";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";

// RenderList — präsentationaler View für entityList-Screens.
//
// Daten + State sind komplett controlled vom Caller (KumikoScreen):
//   - rows kommen aus dem Server (durch useQuery + URL-State-Payload)
//   - sort/q sind Props, RenderList ruft onSortChange/onQChange wenn
//     der User UI-Aktionen macht
//   - Search ist serverseitig (via SearchAdapter / Meilisearch). Lokaler
//     State im Search-Input ist nur Debounce-Buffer, keine Filterung.
//
// Apps die RenderList ohne Server-State nutzen wollen (z.B. ein
// statischer Lookup) liefern stabile rows + lassen sort/q weg —
// DataTable fällt dann auf "kein Sort-Wiring + kein Search" zurück.

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
  /** Label für den + Neu Button. Default kommt aus dem i18n-Bundle
   *  (`kumiko.actions.create`). Caller kann durch eigenen String
   *  überschreiben. */
  readonly createLabel?: string;
  /** Aktiviert ein Search-Input in der Toolbar. Server-side Filter
   *  via Caller's onSearchChange — RenderList filtert NICHT lokal. */
  readonly searchable?: boolean;
  /** Placeholder für das Search-Input. Default kommt aus dem i18n-
   *  Bundle (`kumiko.list.search-placeholder`). */
  readonly searchPlaceholder?: string;
  /** Aktueller Search-Term (vom URL-State / Parent). RenderList puffert
   *  Tipps lokal mit 300ms Debounce, bevor onSearchChange gefeuert
   *  wird — sonst macht jeder Tastendruck einen Server-Roundtrip. */
  readonly searchValue?: string;
  /** Wird gerufen wenn der debounced Search-Term sich ändert. Caller
   *  setzt damit URL-State (?<id>.q=…) und triggert ein refetch. */
  readonly onSearchChange?: (next: string) => void;
  /** Aktuelle Sortierung (oder null = Server-Default-Order). */
  readonly sort?: ListSort | null;
  /** Wird gerufen mit dem nächsten Sort-State nach einem Header-Klick. */
  readonly onSortChange?: (next: ListSort | null) => void;
  /** Pager-Props für pagination="pages". Wenn undefined, kein Pager-
   *  UI — Default oder infinite-Mode. KumikoScreen liefert das je nach
   *  screen.pagination. */
  readonly pager?: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly onPageChange: (next: number) => void;
  };
};

const SEARCH_DEBOUNCE_MS = 300;

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
    createLabel,
    searchable = false,
    searchPlaceholder,
    searchValue,
    onSearchChange,
    sort,
    onSortChange,
    pager,
  } = props;
  // Wie RenderEdit: Translate-Fallback aus dem i18next-Context, sonst
  // wären Column-Header raw i18n-Keys.
  const t = useTranslation();
  const translate: Translate = translateProp ?? t;
  const { DataTable, Button, Input, Text } = usePrimitives();

  // Local Search-Buffer + Debounce. Externe Änderungen (Browser-Back,
  // Cross-Component-Reset) spiegeln wir per Sync-Effect zurück; Tipps
  // im Input feuern onSearchChange erst nach 300ms ohne weitere Tasten.
  const [localQ, setLocalQ] = useState(searchValue ?? "");
  useEffect(() => {
    setLocalQ(searchValue ?? "");
  }, [searchValue]);
  useEffect(() => {
    if (onSearchChange === undefined) return;
    if (localQ === (searchValue ?? "")) return;
    const timer = setTimeout(() => onSearchChange(localQ), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [localQ, searchValue, onSearchChange]);

  const vm = useMemo(
    () => computeListViewModel({ screen, entity, rows, translate, featureName }),
    [screen, entity, rows, translate, featureName],
  );

  // i18n-Defaults für Toolbar/Empty-State Strings — Caller kann jeden
  // einzeln per Prop überschreiben, sonst kommen die Framework-Bundles
  // (kumiko.actions.create, kumiko.list.search-placeholder, …).
  const effectiveCreateLabel = createLabel ?? translate("kumiko.actions.create");
  const effectiveSearchPlaceholder =
    searchPlaceholder ?? translate("kumiko.list.search-placeholder");

  const toolbarStart = searchable ? (
    <Input
      kind="text"
      id="render-list-search"
      name="search"
      value={localQ}
      onChange={setLocalQ}
      placeholder={effectiveSearchPlaceholder}
    />
  ) : undefined;

  const toolbarEnd =
    onCreate !== undefined ? (
      <Button variant="primary" onClick={onCreate} testId="render-list-create">
        {`+ ${effectiveCreateLabel}`}
      </Button>
    ) : undefined;

  // Empty-State: Default zeigt Heading + Description + optional CTA-
  // Button. Caller kann via emptyState-Prop komplett überschreiben.
  // Wenn weder onCreate noch ein Override gegeben ist, fällt die
  // DataTable auf den DataTable-Default zurück (`kumiko.list.no-entries`).
  const composedEmptyState =
    emptyState ??
    (onCreate !== undefined ? (
      <>
        <Text>{translate("kumiko.list.empty.title")}</Text>
        <Text variant="small">{translate("kumiko.list.empty.hint")}</Text>
        <Button variant="primary" onClick={onCreate} testId="render-list-empty-create">
          {`+ ${effectiveCreateLabel}`}
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

  // ListSort = DataTableSort (use-list-url-state aliased) — kein Cast nötig.
  return (
    <DataTable
      columns={vm.columns}
      rows={vm.rows}
      toolbarTitle={toolbarTitle}
      {...(onRowClick !== undefined && { onRowClick })}
      {...(composedEmptyState !== undefined && { emptyState: composedEmptyState })}
      {...(toolbarStart !== undefined && { toolbarStart })}
      {...(toolbarEnd !== undefined && { toolbarEnd })}
      {...(sort !== undefined && { sort })}
      {...(onSortChange !== undefined && { onSortChange })}
      {...(pager !== undefined && { pager })}
      testId="render-list-table"
    />
  );
}
