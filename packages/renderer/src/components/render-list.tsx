import type { EagerloadedRow } from "@cosmicdrift/kumiko-framework/db";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { ListRowViewModel, Translate } from "@cosmicdrift/kumiko-headless";
import { computeListViewModel } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { ListSort } from "../hooks/use-list-url-state";
import { type ReferenceLookupMap, useReferenceLookup } from "../hooks/use-reference-lookup";
import { useTranslation } from "../i18n";
import { type DataTableRowAction, usePrimitives } from "../primitives";

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
  /** Infinite-Scroll-Wiring für pagination="infinite". KumikoScreen
   *  hält accumulated rows + cursor, RenderList reicht die Callbacks
   *  einfach durch an DataTable. */
  readonly onReachEnd?: () => void;
  readonly loadingMore?: boolean;
  readonly hasMore?: boolean;
  /** Pro-Row-Aktionen — Resolved-Form (KumikoScreen baut das aus
   *  EntityListScreenDefinition.rowActions: handler-QN → dispatcher-Call,
   *  i18n-Keys → translated Strings). */
  readonly rowActions?: readonly DataTableRowAction[];
  /** Toolbar-Aktionen im List-Header — Resolved-Form (KumikoScreen baut
   *  das aus EntityListScreenDefinition.toolbarActions: navigate-target
   *  → useNav, handler-QN → dispatcher-Call). RenderList rendert die
   *  Buttons rechts in der Toolbar, vor "+ Neu". */
  readonly toolbarActions?: readonly ToolbarActionButton[];
};

// Resolved-Form einer Toolbar-Action: KumikoScreen baut das aus dem
// Schema (entweder navigate- oder writeHandler-kind), RenderList sieht
// nur einen onTrigger-Callback + Label/Style — keine kind-Discrimination
// mehr.
export type ToolbarActionButton = {
  readonly id: string;
  readonly label: string;
  readonly style?: "primary" | "secondary" | "danger";
  readonly confirm?: string;
  readonly confirmLabel?: string;
  readonly onTrigger: () => Promise<void> | void;
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
    onReachEnd,
    loadingMore,
    hasMore,
    rowActions,
    toolbarActions,
  } = props;
  // Wie RenderEdit: Translate-Fallback aus dem i18next-Context, sonst
  // wären Column-Header raw i18n-Keys.
  const t = useTranslation();
  const translate: Translate = translateProp ?? t;
  const { DataTable, Button, Dialog, Input, Text } = usePrimitives();

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

  // Tier 2.7e-4: Reference-Field-Eagerload via Bridge-Component-Pattern.
  // Hooks-Rule-Konflikt: pro reference-Spalte muss useReferenceLookup
  // gerufen werden, aber die Anzahl varriiert per Schema. Lösung —
  // ReferenceLookupBridge-Komponenten pro Spalte gemountet, die ihre
  // Map über onMap-Callback in einen lokalen State veröffentlichen.
  // Anzahl der Hook-Calls pro Bridge-Component ist konstant (1), und
  // React verwaltet die mounted/unmounted Lifecycles beim Schema-
  // Wechsel über die key-Property automatisch.
  const referenceColumns = useMemo(
    () =>
      vm.columns
        .filter((c) => c.type === "reference" && c.refEntity !== undefined)
        .map((c) => ({
          field: c.field,
          refEntity: c.refEntity ?? "",
          // Tier 2.7e Cross-Feature: refFeature kommt aus parseRefTarget
          // im ViewModel (default = current featureName).
          refFeature: c.refFeature ?? featureName,
          labelField: c.refLabelField ?? "id",
        })),
    [vm.columns, featureName],
  );
  const [referenceLookups, setReferenceLookups] = useState<Record<string, ReferenceLookupMap>>({});
  const handleLookupMap = useCallback((field: string, map: ReferenceLookupMap) => {
    setReferenceLookups((prev) => {
      // skip-update wenn die Map identisch ist (Render-Loop-Schutz —
      // Bridge-Component re-rendert sonst und schickt die gleiche Map
      // wieder rein bis React in eine Endlosschleife geht).
      if (prev[field] === map) return prev;
      return { ...prev, [field]: map };
    });
  }, []);
  const enrichedColumns = useMemo(() => {
    if (referenceColumns.length === 0) return vm.columns;
    return vm.columns.map((col) => {
      if (col.type !== "reference") return col;
      // Author-deklarierter Renderer übersteuert immer — Default greift
      // nur wenn keiner gesetzt ist.
      if (col.renderer !== undefined) return col;
      const map = referenceLookups[col.field];
      const labelField = col.refLabelField ?? "id";
      const renderer = (value: unknown, row?: Readonly<Record<string, unknown>>): string => {
        // Tier 2.7e Server-Eagerload: wenn der Server _refs mit-
        // schickt, lesen wir den Display-Wert direkt aus der
        // resolved Row — kein Roundtrip durch die Bridge-Map nötig
        // und keine limit:200-Constraint. EagerloadedRow-Type aus
        // @cosmicdrift/kumiko-framework/db pinnt die Form von _refs.
        const eagerloadedRow = row as EagerloadedRow | undefined;
        const resolved = eagerloadedRow?._refs?.[col.field];
        if (Array.isArray(resolved) && resolved.length > 0) {
          return resolved.map((r) => String(r[labelField] ?? r["id"] ?? "")).join(", ");
        }
        if (resolved !== undefined && !Array.isArray(resolved)) {
          const single = resolved as Record<string, unknown>; // @cast-boundary render-helper
          return String(single[labelField] ?? single["id"] ?? "");
        }
        // Renderer-Side-Fallback (kein Server-Eagerload aktiv).
        if (Array.isArray(value)) {
          if (value.length === 0) return "—";
          return value.map((v) => map?.get(String(v)) ?? String(v)).join(", ");
        }
        if (value === null || value === undefined || value === "") return "—";
        const idStr = String(value);
        return map?.get(idStr) ?? idStr;
      };
      return { ...col, renderer };
    });
  }, [vm.columns, referenceColumns, referenceLookups]);
  const enrichedVm = useMemo(() => ({ ...vm, columns: enrichedColumns }), [vm, enrichedColumns]);

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

  // Toolbar-End-Slot: Toolbar-Actions (List-Header-Buttons aus dem
  // Schema) + optional "+ Neu" am rechten Edge. Reihenfolge im Rendering
  // = Reihenfolge im Array (Schema-deklariert), "+ Neu" kommt zuletzt
  // weil das die häufigste/auffälligste CTA ist.
  const hasToolbarActions = toolbarActions !== undefined && toolbarActions.length > 0;
  const toolbarEnd =
    hasToolbarActions || onCreate !== undefined ? (
      <>
        {hasToolbarActions &&
          toolbarActions.map((a) => (
            <ToolbarActionView key={a.id} action={a} Button={Button} Dialog={Dialog} />
          ))}
        {onCreate !== undefined && (
          <Button variant="primary" onClick={onCreate} testId="render-list-create">
            {`+ ${effectiveCreateLabel}`}
          </Button>
        )}
      </>
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
    <>
      {referenceColumns.map((rc) => (
        <ReferenceLookupBridge
          key={rc.field}
          field={rc.field}
          refEntity={rc.refEntity}
          labelField={rc.labelField}
          featureName={rc.refFeature}
          onMap={handleLookupMap}
        />
      ))}
      <DataTable
        columns={enrichedVm.columns}
        rows={enrichedVm.rows}
        toolbarTitle={toolbarTitle}
        {...(onRowClick !== undefined && { onRowClick })}
        {...(composedEmptyState !== undefined && { emptyState: composedEmptyState })}
        {...(toolbarStart !== undefined && { toolbarStart })}
        {...(toolbarEnd !== undefined && { toolbarEnd })}
        {...(sort !== undefined && { sort })}
        {...(onSortChange !== undefined && { onSortChange })}
        {...(pager !== undefined && { pager })}
        {...(onReachEnd !== undefined && { onReachEnd })}
        {...(loadingMore !== undefined && { loadingMore })}
        {...(hasMore !== undefined && { hasMore })}
        {...(rowActions !== undefined && { rowActions })}
        testId="render-list-table"
      />
    </>
  );
}

// Tier 2.7e-4: Bridge-Component pro reference-Spalte. Mounted für jede
// Spalte einmal, ruft useReferenceLookup unconditional (Hook-Rules
// happy), und published die Map über onMap an den Parent. React
// verwaltet das Mounting/Unmounting beim Schema-Wechsel über die
// key-Prop im map-Loop des Parents.
function ReferenceLookupBridge({
  field,
  refEntity,
  labelField,
  featureName,
  onMap,
}: {
  readonly field: string;
  readonly refEntity: string;
  readonly labelField: string;
  readonly featureName: string;
  readonly onMap: (field: string, map: ReferenceLookupMap) => void;
}): null {
  const lookup = useReferenceLookup(featureName, refEntity, labelField);
  // useEffect statt direktem call damit setState außerhalb des Render-
  // Pfads passiert (sonst React-Warning "Cannot update a component
  // while rendering a different component").
  useEffect(() => {
    onMap(field, lookup.map);
  }, [field, lookup.map, onMap]);
  return null;
}

// ToolbarActionView — pro Toolbar-Action ein Button (+ Confirm-Dialog
// wenn confirm gesetzt). Same Pattern wie RowAction (Inline-Variante)
// aber ohne row-Context. busy-State während async onTrigger; Dialog
// öffnet sich vor dem Trigger wenn confirm/danger gesetzt.
function ToolbarActionView({
  action,
  Button,
  Dialog,
}: {
  readonly action: ToolbarActionButton;
  readonly Button: ReturnType<typeof usePrimitives>["Button"];
  readonly Dialog: ReturnType<typeof usePrimitives>["Dialog"];
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const trigger = async (): Promise<void> => {
    setBusy(true);
    try {
      await action.onTrigger();
    } finally {
      setBusy(false);
    }
  };

  const variant: "primary" | "secondary" | "danger" = action.style ?? "secondary";
  const needsConfirm = action.confirm !== undefined || action.style === "danger";

  return (
    <>
      <Button
        variant={variant}
        loading={busy}
        onClick={() => {
          if (needsConfirm) {
            setConfirmOpen(true);
          } else {
            void trigger();
          }
        }}
        testId={`render-list-toolbar-action-${action.id}`}
      >
        {action.label}
      </Button>
      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={action.label}
        {...(action.confirm !== undefined && { description: action.confirm })}
        confirmLabel={action.confirmLabel ?? action.label}
        {...(action.style === "danger" && { variant: "danger" as const })}
        onConfirm={trigger}
        testId={`render-list-toolbar-action-${action.id}-dialog`}
      />
    </>
  );
}
