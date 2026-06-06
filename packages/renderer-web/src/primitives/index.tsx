// shadcn+Tailwind Default-Primitives für den Web-Renderer.
// Konsumieren den Primitives-Contract aus `@cosmicdrift/kumiko-renderer`. Keine
// useTokens()-Aufrufe — die Farben kommen aus den Tailwind-Klassen
// die auf die shadcn-CSS-Variablen referenzieren.
//
// Muster: pro Primitive eine Tailwind-Klassen-Komposition,
// Konfigurierbarkeit über `class-variance-authority` für variant-
// basierte Stile. Radix-UI-Unterbau für interaktive Elemente (Modal,
// Dropdown etc. kommen später).

import type { ListRowViewModel } from "@cosmicdrift/kumiko-headless";
import type {
  DataTableRowAction,
  DataTableSort,
  DataTableSortDir,
} from "@cosmicdrift/kumiko-renderer";
import {
  type BannerProps,
  type ButtonProps,
  type CorePrimitives,
  type DataTableProps,
  type FieldProps,
  type FormProps,
  type GridCellProps,
  type GridProps,
  type HeadingProps,
  type InputProps,
  type SectionProps,
  type TextProps,
  useColumnRenderer,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva } from "class-variance-authority";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { ComboboxInput } from "./combobox";
import { DateInput } from "./date-input";
import { DefaultDialog } from "./dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { MoneyInput } from "./money-input";

// ---- Button ----

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors " +
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
    "disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        secondary:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        danger: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

function DefaultButton({
  type = "button",
  onClick,
  disabled,
  loading,
  variant = "primary",
  children,
  testId,
}: ButtonProps): ReactNode {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled === true || loading === true}
      data-testid={testId}
      data-loading={loading === true ? "true" : undefined}
      className={cn(buttonVariants({ variant }), "h-9 px-4 py-2")}
    >
      {loading === true ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : children}
    </button>
  );
}

// ---- Banner (shadcn: Alert) ----

function DefaultBanner({
  variant = "info",
  children,
  actions,
  padded,
  testId,
}: BannerProps): ReactNode {
  const isError = variant === "error";
  const banner = (
    <div
      data-testid={testId}
      role={isError ? "alert" : undefined}
      data-variant={variant}
      className={cn(
        "relative w-full rounded-lg border px-4 py-3 text-sm flex items-center gap-3",
        isError
          ? "border-destructive/50 text-destructive bg-destructive/10 dark:border-destructive"
          : "bg-card text-card-foreground",
      )}
    >
      <div className="flex-1">{children}</div>
      {actions !== undefined && <div data-slot="actions">{actions}</div>}
    </div>
  );
  // Page-State: Banner sitzt alleine im Main (das kein Padding mehr
  // hat). Wrapper gibt 24px Außenabstand damit der Banner nicht edge-
  // to-edge an Sidebar/Browser klebt.
  return padded === true ? <div className="p-6">{banner}</div> : banner;
}

// ---- Field (Label + Error) ----

function DefaultField({
  id,
  label,
  required,
  issues,
  labelAppendix,
  fieldAppendix,
  children,
  testId,
}: FieldProps): ReactNode {
  const t = useTranslation();
  const hasError = issues !== undefined && issues.length > 0;
  return (
    <div data-testid={testId} className="flex flex-col gap-1.5">
      <LabelPrimitive.Root
        htmlFor={id}
        className={cn(
          // peer-disabled-Sentinel: shadcn-Pattern — wenn das assoziierte
          // Input disabled ist (peer + disabled-Klasse), wird das Label
          // mitgrayout. Funktioniert weil Radix-Label das nativ-htmlFor-
          // verlinkte Element als Peer betrachtet.
          "text-sm font-medium leading-none",
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          hasError ? "text-destructive" : "text-foreground",
        )}
      >
        {label}
        {labelAppendix !== undefined && <>{labelAppendix}</>}
        {required === true && <span className="ml-0.5 text-destructive">*</span>}
      </LabelPrimitive.Root>
      {children}
      {fieldAppendix !== undefined && <div className="mt-1">{fieldAppendix}</div>}
      {hasError && (
        <div
          role="alert"
          data-testid={testId !== undefined ? `${testId}-errors` : undefined}
          className="text-xs text-destructive"
        >
          {issues.map((issue) => (
            <div key={`${issue.path}:${issue.code}`}>{t(issue.i18nKey)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Input ----

const inputClassBase =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm " +
  "transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

function DefaultInput(props: InputProps): ReactNode {
  const errorClass =
    props.hasError === true ? "border-destructive focus-visible:ring-destructive" : "";
  const common = {
    id: props.id,
    name: props.name,
    disabled: props.disabled,
    "aria-required": props.required,
    "aria-invalid": props.hasError === true ? true : undefined,
  } as const;
  switch (props.kind) {
    case "text":
      return (
        <input
          type="text"
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
          {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
          {...(props.autoComplete !== undefined && { autoComplete: props.autoComplete })}
          className={cn(inputClassBase, errorClass)}
        />
      );
    case "email":
      return (
        <input
          type="email"
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
          {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
          autoComplete={props.autoComplete ?? "email"}
          className={cn(inputClassBase, errorClass)}
        />
      );
    case "password":
      return (
        <input
          type="password"
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
          autoComplete={props.autoComplete ?? "current-password"}
          className={cn(inputClassBase, errorClass)}
        />
      );
    case "number":
      return (
        <input
          type="number"
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const v = e.target.value;
            props.onChange(v === "" ? undefined : Number(v));
          }}
          className={cn(inputClassBase, "text-right tabular-nums", errorClass)}
        />
      );
    case "boolean":
      return (
        <input
          type="checkbox"
          {...common}
          checked={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.checked)}
          className={cn(
            "h-4 w-4 rounded-sm border border-input accent-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            errorClass,
          )}
        />
      );
    case "date":
      return (
        <DateInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          {...(props.locale !== undefined && { locale: props.locale })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    case "select": {
      // Visual-Konsolidierung: alle Selects laufen über ComboboxInput
      // (cmdk + Radix-Popover). Vorher hatten wir zwei Pfade — Radix-
      // Select für `kind:"select"` und cmdk für `kind:"combobox"`. Drei
      // visuell unterschiedliche Variants (Single-Select, Combobox-
      // Single, Combobox-Multi) wurden unhandbar. Mit dem Merge ist die
      // Combobox die einzige Implementation: Search-Input ist auch bei
      // 4-Item-Status-Selects vorhanden, das ist eine bewusst akzeptierte
      // UX-Konsequenz für Style-Konsistenz.
      const comboOptions = props.options.map((o) =>
        typeof o === "string" ? { value: o, label: o } : o,
      );
      return (
        <ComboboxInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          options={comboOptions}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    }
    case "combobox": {
      // Tier 2.1c + Tier 2.7e: Discriminated-Union per `multiple` —
      // wir splittan TS-side in zwei Branches damit ComboboxInput's
      // Single/Multi-Variants typgerecht gerendert werden.
      const baseProps = {
        id: props.id,
        name: props.name,
        options: props.options,
        ...(props.disabled !== undefined && { disabled: props.disabled }),
        ...(props.required !== undefined && { required: props.required }),
        ...(props.hasError !== undefined && { hasError: props.hasError }),
        ...(props.placeholder !== undefined && { placeholder: props.placeholder }),
        ...(props.searchPlaceholder !== undefined && {
          searchPlaceholder: props.searchPlaceholder,
        }),
        ...(props.emptyText !== undefined && { emptyText: props.emptyText }),
        ...(props.onSearchChange !== undefined && { onSearchChange: props.onSearchChange }),
        ...(props.loading !== undefined && { loading: props.loading }),
      } as const;
      if (props.multiple === true) {
        return (
          <ComboboxInput {...baseProps} multiple value={props.value} onChange={props.onChange} />
        );
      }
      return <ComboboxInput {...baseProps} value={props.value} onChange={props.onChange} />;
    }
    case "money":
      return (
        <MoneyInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          currency={props.currency ?? "EUR"}
          {...(props.locale !== undefined && { locale: props.locale })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    case "timestamp":
      return (
        <input
          type="datetime-local"
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            props.onChange(e.target.value !== "" ? e.target.value : undefined)
          }
          className={cn(inputClassBase, errorClass)}
        />
      );
    case "textarea":
      // Default 4 Zeilen — vertikal-resize via resize-y. min-h damit
      // ein bewusstes rows={2} nicht unter eine sinnvolle Mindesthöhe
      // schrumpft. Field-Klasse wird leicht angepasst (kein h-9 weil
      // multiline).
      return (
        <textarea
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => props.onChange(e.target.value)}
          rows={props.rows ?? 4}
          className={cn(
            "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm",
            "transition-colors placeholder:text-muted-foreground focus-visible:outline-none",
            "focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            "resize-y min-h-[80px]",
            errorClass,
          )}
        />
      );
  }
}

// ---- DataTable (shadcn: Table) ----

function DefaultDataTable({
  columns,
  rows,
  onRowClick,
  sort,
  onSortChange,
  emptyState,
  toolbarTitle,
  toolbarStart,
  toolbarEnd,
  pager,
  onReachEnd,
  loadingMore,
  hasMore,
  rowActions,
  testId,
}: DataTableProps): ReactNode {
  // Toolbar-Wrapper: gemeinsamer Container für Toolbar+Tabelle damit
  // beide visuell zusammengehören. Toolbar ist NICHT sticky — Lists
  // scrollen typischerweise mit dem Page-Container, nicht intern.
  // Sticky würde mit der Topbar konkurrieren.
  const tableContent =
    rows.length === 0 ? (
      <div
        data-testid={testId !== undefined ? `${testId}-empty` : "render-list-empty"}
        className="flex flex-col items-center justify-center rounded-md border border-dashed p-12 text-sm text-muted-foreground gap-3"
      >
        {emptyState ?? <span>No entries.</span>}
      </div>
    ) : (
      <div className="rounded-md border overflow-x-auto">
        <table data-testid={testId} className="w-full caption-bottom text-sm">
          {tableInner(columns, rows, onRowClick, sort, onSortChange, rowActions)}
        </table>
      </div>
    );

  // Pager wird IMMER unter der Tabelle gerendert (auch bei rows=[]),
  // damit der User bei einem Filter-Hit-of-Zero zurückblättern kann
  // ohne die Liste zu verlieren. Außer total === 0 — dann gibt's
  // nichts zu paginieren. Inkompatibel mit Infinite-Scroll: Caller
  // setzt entweder pager ODER onReachEnd.
  const content =
    pager !== undefined && pager.total > 0 ? (
      <>
        {tableContent}
        <Pager
          page={pager.page}
          limit={pager.limit}
          total={pager.total}
          onPageChange={pager.onPageChange}
          testId={testId !== undefined ? `${testId}-pager` : "render-list-pager"}
        />
      </>
    ) : onReachEnd !== undefined ? (
      <>
        {tableContent}
        <InfiniteSentinel
          onReachEnd={onReachEnd}
          loadingMore={loadingMore === true}
          hasMore={hasMore !== false}
          testId={testId !== undefined ? `${testId}-sentinel` : "render-list-sentinel"}
        />
      </>
    ) : (
      tableContent
    );

  const hasToolbar =
    toolbarTitle !== undefined || toolbarStart !== undefined || toolbarEnd !== undefined;
  if (!hasToolbar) return <div className="p-6">{content}</div>;

  // Toolbar als full-width Bar (Main hat kein Padding, also nimmt die
  // Bar von alleine die volle Breite). bg-muted/30 + border-b geben
  // die visuelle Distinction zum Content. Content darunter bekommt
  // eigenes p-6 damit Tabelle/Empty-State nicht an die Edges kleben.
  return (
    <div className="flex flex-col w-full">
      <div
        data-testid={testId !== undefined ? `${testId}-toolbar` : "render-list-toolbar"}
        className="h-12 px-6 bg-muted/30 border-b flex items-center gap-3"
      >
        {toolbarTitle !== undefined && (
          <div className="text-lg font-semibold tracking-tight truncate">{toolbarTitle}</div>
        )}
        {toolbarStart !== undefined && <div className="flex-1 max-w-sm">{toolbarStart}</div>}
        {toolbarEnd !== undefined && (
          <div className="flex items-center gap-2 ml-auto">{toolbarEnd}</div>
        )}
      </div>
      <div className="p-6">{content}</div>
    </div>
  );
}

function tableInner(
  columns: DataTableProps["columns"],
  rows: DataTableProps["rows"],
  onRowClick?: DataTableProps["onRowClick"],
  sort?: DataTableProps["sort"],
  onSortChange?: DataTableProps["onSortChange"],
  rowActions?: DataTableProps["rowActions"],
): ReactNode {
  const hasActions = rowActions !== undefined && rowActions.length > 0;
  return (
    <>
      <thead className="[&_tr]:border-b">
        <tr className="border-b transition-colors hover:bg-muted/50">
          {columns.map((col) => (
            <SortableHeader
              key={col.field}
              field={col.field}
              label={col.label}
              sortable={col.sortable === true}
              {...(sort !== undefined && sort !== null && { sort })}
              {...(onSortChange !== undefined && { onSortChange })}
            />
          ))}
          {hasActions && (
            <th
              data-testid="column-actions"
              // sticky right-0 + bg-background damit die Action-Spalte
              // beim horizontalen Scroll am rechten Rand bleibt und
              // nicht vom Inhalt überdeckt wird (Linear-Pattern).
              className="h-10 px-4 text-right align-middle font-medium text-muted-foreground w-px whitespace-nowrap sticky right-0 bg-background z-10 border-l"
              aria-label="Actions"
            />
          )}
        </tr>
      </thead>
      <tbody className="[&_tr:last-child]:border-0">
        {rows.map((row) => (
          <tr
            key={row.id}
            data-testid={`row-${row.id}`}
            onClick={onRowClick !== undefined ? () => onRowClick(row) : undefined}
            className={cn(
              "border-b transition-colors hover:bg-muted/50",
              onRowClick !== undefined && "cursor-pointer",
            )}
          >
            {columns.map((col) => (
              <td
                key={col.field}
                data-testid={`cell-${row.id}-${col.field}`}
                // Cells truncaten lange Werte mit ellipsis statt umzu-
                // brechen — Lists bleiben einzeilig + scannbar (Linear-
                // Pattern). max-w-xs gibt eine vernünftige Default-
                // Obergrenze; die <table>-Wrapper hat overflow-x für
                // horizontalen Scroll falls die Summe der Spalten zu
                // breit wird.
                className="p-4 align-middle max-w-xs truncate"
                title={cellTitle(row.values[col.field])}
              >
                <DataTableCell
                  value={row.values[col.field]}
                  row={row.values}
                  field={col.field}
                  type={col.type}
                  renderer={col.renderer}
                  {...(col.optionLabels !== undefined && { optionLabels: col.optionLabels })}
                />
              </td>
            ))}
            {hasActions && (
              <td
                data-testid={`cell-${row.id}-actions`}
                // Sticky-right damit beim horizontalen Scroll die Actions
                // am rechten Rand sichtbar bleiben. bg-background +
                // border-l für den visuellen Abschluss.
                className="p-2 align-middle text-right whitespace-nowrap sticky right-0 bg-background z-10 border-l"
                // Action-Cell-Events dürfen nicht den Row-Click/Activation
                // triggern (typisch "Open Detail" — der User wollte ja die
                // Action, nicht navigieren). Wir stopPropagation für Mouse
                // UND Keyboard, damit a11y konsistent ist.
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <RowActionsCell row={row} actions={rowActions} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </>
  );
}

// RowActionsCell — entscheidet zwischen Inline-Buttons (≤2 actions) und
// Kebab-Dropdown (>2). isVisible-Filter wird hier ausgeführt; eine action
// die für eine Row unsichtbar ist, kommt nicht in den Render. Wenn alle
// Actions für eine Row hidden sind, bleibt die Cell leer (keine
// Phantom-Spalte).
function RowActionsCell({
  row,
  actions,
}: {
  readonly row: ListRowViewModel;
  readonly actions: readonly DataTableRowAction[];
}): ReactNode {
  const visible = actions.filter((a) => a.isVisible === undefined || a.isVisible(row));
  if (visible.length === 0) return null;
  if (visible.length <= 2) {
    return (
      <div className="inline-flex items-center gap-1 justify-end">
        {visible.map((a) => (
          <RowActionButton key={a.id} row={row} action={a} />
        ))}
      </div>
    );
  }
  return <RowActionsKebab row={row} actions={visible} />;
}

// Shared trigger-State zwischen Inline-Button + Kebab-Item: busy-Flag
// (während async onTrigger läuft) + confirm-pending-Action. Beide Sub-
// Components hatten denselben State-Block dupliziert + parallel zur
// Confirm-Dialog-Render-Logic — der Hook konsolidiert das.
//
// "needsConfirm" Helper kapselt die Regel: explizites confirm ODER
// style=danger triggert den Dialog, alles andere fired direkt.
function needsConfirm(action: DataTableRowAction): boolean {
  return action.confirm !== undefined || action.style === "danger";
}

function useRowActionTrigger(row: ListRowViewModel) {
  const [busy, setBusy] = useState(false);
  const triggerNow = async (action: DataTableRowAction): Promise<void> => {
    setBusy(true);
    try {
      await action.onTrigger(row);
    } finally {
      setBusy(false);
    }
  };
  return { busy, triggerNow };
}

function RowActionButton({
  row,
  action,
}: {
  readonly row: ListRowViewModel;
  readonly action: DataTableRowAction;
}): ReactNode {
  const { busy, triggerNow } = useRowActionTrigger(row);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const variantClass =
    action.style === "danger"
      ? "text-destructive hover:bg-destructive/10"
      : action.style === "primary"
        ? "text-primary hover:bg-primary/10"
        : "text-foreground hover:bg-accent";

  return (
    <>
      <button
        type="button"
        data-testid={`row-${row.id}-action-${action.id}`}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          if (needsConfirm(action)) {
            setConfirmOpen(true);
          } else {
            void triggerNow(action);
          }
        }}
        className={cn(
          "inline-flex h-8 items-center justify-center rounded-sm px-2 text-sm",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:opacity-50 disabled:pointer-events-none",
          variantClass,
        )}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : action.label}
      </button>
      <DefaultDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={action.label}
        {...(action.confirm !== undefined && { description: action.confirm })}
        confirmLabel={action.confirmLabel ?? action.label}
        {...(action.style === "danger" && { variant: "danger" as const })}
        onConfirm={() => triggerNow(action)}
        testId={`row-${row.id}-action-${action.id}-dialog`}
      />
    </>
  );
}

// Kebab-Dropdown für >2 actions. Confirm-Dialog ist hier inline pro
// Item analog zum Inline-Button-Pfad — ein gemeinsamer State-Holder
// per Action damit das Dropdown nach dem Click zumacht und der Dialog
// danach öffnet (Radix-Dropdown-Item swallowt den Click sonst).
function RowActionsKebab({
  row,
  actions,
}: {
  readonly row: ListRowViewModel;
  readonly actions: readonly DataTableRowAction[];
}): ReactNode {
  const { triggerNow } = useRowActionTrigger(row);
  const [pendingConfirm, setPendingConfirm] = useState<DataTableRowAction | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            data-testid={`row-${row.id}-actions-menu`}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-sm",
              "hover:bg-accent text-muted-foreground hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.id}
              data-testid={`row-${row.id}-action-${action.id}`}
              onSelect={(e) => {
                e.preventDefault();
                if (needsConfirm(action)) {
                  setPendingConfirm(action);
                } else {
                  void triggerNow(action);
                }
              }}
              className={cn(action.style === "danger" && "text-destructive focus:text-destructive")}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {pendingConfirm !== null && (
        <DefaultDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setPendingConfirm(null);
          }}
          title={pendingConfirm.label}
          {...(pendingConfirm.confirm !== undefined && { description: pendingConfirm.confirm })}
          confirmLabel={pendingConfirm.label}
          {...(pendingConfirm.style === "danger" && { variant: "danger" as const })}
          onConfirm={async () => {
            const action = pendingConfirm;
            setPendingConfirm(null);
            await triggerNow(action);
          }}
          testId={`row-${row.id}-action-${pendingConfirm.id}-dialog`}
        />
      )}
    </>
  );
}

// InfiniteSentinel — leeres div am Ende der Tabelle, das via
// IntersectionObserver erkennt wann der User in die Nähe des Listen-
// Endes scrollt. onReachEnd feuert genau einmal pro "wird sichtbar"-
// Übergang; der Caller debounced via loadingMore (während eine Page
// lädt, ignorieren wir weitere Sichtbar-Events). Kein observer in
// Server-Side-Render, kein observer wenn hasMore=false — dann zeigt
// der Sentinel nur den End-of-list-Hinweis.
function InfiniteSentinel({
  onReachEnd,
  loadingMore,
  hasMore,
  testId,
}: {
  readonly onReachEnd: () => void;
  readonly loadingMore: boolean;
  readonly hasMore: boolean;
  readonly testId?: string;
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore) return;
    if (loadingMore) return;
    if (typeof IntersectionObserver === "undefined") return;
    const node = ref.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Nur das erste sichtbar-Event pro Mount auslösen — wenn der
        // User weiter scrollt während noch geladen wird, hindert
        // loadingMore=true den useEffect dass er den Observer überhaupt
        // erst remountet.
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onReachEnd();
            break;
          }
        }
      },
      { rootMargin: "200px" }, // pre-fetch wenn der Sentinel 200px vom Viewport ist
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onReachEnd, loadingMore, hasMore]);

  return (
    <div
      ref={ref}
      data-testid={testId}
      className="flex items-center justify-center py-4 text-sm text-muted-foreground"
    >
      {!hasMore ? (
        <span data-testid={testId !== undefined ? `${testId}-end` : undefined}>
          — End of list —
        </span>
      ) : loadingMore ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        // Unsichtbar-Spacer wenn weder loading noch end — der Observer
        // braucht ein DOM-Node, der User soll aber nichts sehen.
        <span aria-hidden="true">&nbsp;</span>
      )}
    </div>
  );
}

// Pager — klassischer Page-Pager (← 1 … N →) für DataTables mit
// pagination="pages". Layout: Status-Text links ("X – Y of Z"),
// Page-Buttons mittig, Prev/Next pfeile außen. Window-of-7 zeigt nicht
// alle Pages bei großen Listen — der User sieht den aktuellen Bereich
// + first/last als Anchor.
function Pager({
  page,
  limit,
  total,
  onPageChange,
  testId,
}: {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly onPageChange: (next: number) => void;
  readonly testId?: string;
}): ReactNode {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const from = (safePage - 1) * limit + 1;
  const to = Math.min(safePage * limit, total);
  const visible = computeVisiblePages(safePage, totalPages);

  return (
    <div
      data-testid={testId}
      className="flex items-center justify-between mt-3 gap-3 text-sm text-muted-foreground"
    >
      <div data-testid={testId !== undefined ? `${testId}-status` : undefined}>
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </div>
      <div className="flex items-center gap-1">
        <PagerButton
          ariaLabel="Previous page"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          testId={testId !== undefined ? `${testId}-prev` : undefined}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </PagerButton>
        {visible.map((entry, idx) =>
          entry === "ellipsis" ? (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: visible array is pure-derived from safePage/totalPages, so idx is stable across renders. No DnD/Reorder.
              key={`ellipsis-${idx}`}
              className="px-2 text-muted-foreground"
            >
              …
            </span>
          ) : (
            <PagerButton
              key={entry}
              ariaLabel={`Page ${entry}`}
              ariaCurrent={entry === safePage ? "page" : undefined}
              active={entry === safePage}
              onClick={() => onPageChange(entry)}
              testId={testId !== undefined ? `${testId}-page-${entry}` : undefined}
            >
              {entry}
            </PagerButton>
          ),
        )}
        <PagerButton
          ariaLabel="Next page"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          testId={testId !== undefined ? `${testId}-next` : undefined}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </PagerButton>
      </div>
    </div>
  );
}

function PagerButton({
  children,
  onClick,
  ariaLabel,
  ariaCurrent,
  active,
  disabled,
  testId,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly ariaLabel: string;
  readonly ariaCurrent?: "page";
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly testId?: string;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
      data-testid={testId}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-sm px-2 text-sm",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:opacity-40 disabled:pointer-events-none",
        active === true && "bg-accent text-accent-foreground font-medium",
      )}
    >
      {children}
    </button>
  );
}

// Window-of-7 Strategie: erste + letzte Page immer sichtbar als Anker,
// 5 Pages um den aktuellen Wert + Ellipsen wenn Distanz zu first/last
// > 1. Beispiele:
//   p=1, total=20:  [1] 2 3 4 5 … 20
//   p=10, total=20: 1 … 8 9 [10] 11 12 … 20
//   p=20, total=20: 1 … 16 17 18 19 [20]
//   total=5: 1 2 3 4 5 (kein Window nötig)
export function computeVisiblePages(
  page: number,
  totalPages: number,
): readonly (number | "ellipsis")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  // Fenster von 5 Seiten um die aktuelle Seite. An den Rändern wird das
  // Fenster verschoben (nicht abgeschnitten), damit immer 5 Zahlen + die
  // gegenüberliegende Anker-Seite sichtbar sind:
  //   p=1,  total=20: 1 2 3 4 5 … 20
  //   p=10, total=20: 1 … 8 9 10 11 12 … 20
  //   p=20, total=20: 1 … 16 17 18 19 20
  const leftSibling = Math.max(page - 2, 1);
  const rightSibling = Math.min(page + 2, totalPages);
  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < totalPages - 1;

  if (!showLeftEllipsis) {
    return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  }
  if (!showRightEllipsis) {
    const tail: (number | "ellipsis")[] = [1, "ellipsis"];
    for (let i = totalPages - 4; i <= totalPages; i++) tail.push(i);
    return tail;
  }
  const out: (number | "ellipsis")[] = [1, "ellipsis"];
  for (let i = leftSibling; i <= rightSibling; i++) out.push(i);
  out.push("ellipsis", totalPages);
  return out;
}

// SortableHeader — rendert pro Spalte den th-Header, mit oder ohne
// Click-Sort. Drei Pfade:
//   (a) sortable=false ODER kein onSortChange → plain Label, keine
//       Cursor-Interaktion (DataTable rein als View ohne Sort-Wiring).
//   (b) sortable=true + onSortChange → Header ist ein Button, klick
//       cycled asc → desc → null. aria-sort spiegelt den State.
//   (c) sortable=true im Schema, aber keine onSortChange-Prop → still
//       label-only, aber data-sortable=true bleibt damit Tests die
//       Schema-Sicht kennen.
function SortableHeader({
  field,
  label,
  sortable,
  sort,
  onSortChange,
}: {
  readonly field: string;
  readonly label: string;
  readonly sortable: boolean;
  readonly sort?: DataTableSort;
  readonly onSortChange?: (next: DataTableSort | null) => void;
}): ReactNode {
  const active = sort?.field === field ? sort : undefined;
  const ariaSort: "ascending" | "descending" | "none" =
    active?.dir === "asc" ? "ascending" : active?.dir === "desc" ? "descending" : "none";

  if (!sortable || onSortChange === undefined) {
    return (
      <th
        data-testid={`column-${field}`}
        data-sortable={sortable === true ? true : undefined}
        className="h-10 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap"
      >
        {label}
      </th>
    );
  }

  const Icon = active?.dir === "asc" ? ArrowUp : active?.dir === "desc" ? ArrowDown : ArrowUpDown;
  const next = nextSortState(active?.dir, field);

  return (
    <th
      data-testid={`column-${field}`}
      data-sortable="true"
      aria-sort={ariaSort}
      className="h-10 px-4 text-left align-middle font-medium text-muted-foreground"
    >
      <button
        type="button"
        onClick={() => onSortChange(next)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-sm px-2 -mx-2 text-sm font-medium",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          active !== undefined && "text-foreground",
        )}
      >
        <span>{label}</span>
        <Icon className={cn("size-3.5", active === undefined && "opacity-40")} aria-hidden="true" />
      </button>
    </th>
  );
}

// 3-State-Toggle: kein Sort → asc → desc → kein Sort. Idiomatisch für
// Power-User-Listen wo "ich will die Server-Default-Order zurück" eine
// echte Aktion ist (statt unendlich asc↔desc zu togglen).
function nextSortState(current: DataTableSortDir | undefined, field: string): DataTableSort | null {
  if (current === undefined) return { field, dir: "asc" };
  if (current === "asc") return { field, dir: "desc" };
  return null;
}

// Type-guard für die `{ react: { __component: "Name" } }`-Form, in der
// PlatformComponent-Renderer im Schema serialisiert ankommen. Schemas
// reisen über die Wire (Server → Client), echte Component-Refs würden
// das brechen — der String-Key ist die SSoT.
export function isComponentRendererRef(renderer: unknown): { readonly name: string } | undefined {
  if (renderer === null || typeof renderer !== "object") return undefined;
  const reactBranch = (renderer as { react?: unknown }).react;
  if (reactBranch === null || typeof reactBranch !== "object") return undefined;
  const component = (reactBranch as { __component?: unknown }).__component;
  if (typeof component !== "string" || component.length === 0) return undefined;
  return { name: component };
}

// Type-spezifische Default-Cell-Renderer. Author kann pro Spalte einen
// expliziten renderer setzen (Function oder PlatformComponent); ohne
// expliziten renderer fällt DataTableCell hier durch.
//
//   - boolean → ✓ / leer
//   - timestamp/date → locale-formatiert (kein roher ISO-String)
//   - select → human-lesbar (kebab-case → Title Case)
//   - text/number/sonst → toString
export function defaultCellRender(
  value: unknown,
  type: string,
  optionLabels?: Readonly<Record<string, string>>,
): string {
  if (value === null || value === undefined || value === "") return "";
  if (type === "boolean") return value === true ? "✓" : "";
  if (type === "timestamp" || type === "date") return formatDateCell(value, type);
  if (type === "select") {
    const raw = String(value);
    // Translated Label aus dem ViewModel-Builder (Convention-Key
    // `<feature>:entity:<entity>:field:<field>:option:<value>`).
    // Fallback humanizeSlug wenn kein Label registriert — gleiches
    // Verhalten wie vor dem optionLabels-Patch.
    const translated = optionLabels?.[raw];
    if (translated !== undefined && translated !== raw) return translated;
    return humanizeSlug(raw);
  }
  return typeof value === "string" ? value : String(value);
}

function formatDateCell(value: unknown, type: string): string {
  // Server liefert ISO-String oder Temporal.Instant.toJSON() (gleicher
  // ISO-shape). Für `type:"date"` zeigen wir nur das Datum, für
  // `type:"timestamp"` Datum + Uhrzeit. Locale-Default = Browser.
  try {
    const raw = typeof value === "string" ? value : String(value);
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    if (type === "date") {
      return date.toLocaleDateString();
    }
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function humanizeSlug(slug: string): string {
  // "degraded-performance" → "Degraded performance"
  if (slug.length === 0) return slug;
  const spaced = slug.replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Tooltip-Text für truncated Cells — bei Hover zeigt der Browser den
// vollen Text. Skipping für Object/Array (das ist nicht user-readable);
// Number/Boolean stringifyt der Browser ohnehin korrekt.
function cellTitle(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

type DataTableCellProps = {
  readonly value: unknown;
  readonly row: Readonly<Record<string, unknown>>;
  readonly field: string;
  readonly type: string;
  readonly renderer?: unknown;
  readonly optionLabels?: Readonly<Record<string, string>>;
};

// Cell-Renderer als Component (statt reiner Funktion) damit der
// useColumnRenderer-Hook aus dem Provider lesen kann. Die drei Pfade
// sind:
//   1. Funktion → ruft fn(value) auf, returnt String. Bestand-Pfad,
//      bleibt unverändert für alle bestehenden Schemas.
//   2. PlatformComponent (`{ react: { __component: "X" } }`) → schaut
//      "X" über useColumnRenderer auf und rendert `<X value row column/>`.
//      Nicht registriert → einmalige Warnung + Default-Fallback.
//   3. Sonst → defaultCellRender (Type-basierter String-Renderer).
function DataTableCell({
  value,
  row,
  field,
  type,
  renderer,
  optionLabels,
}: DataTableCellProps): ReactNode {
  const componentRef = isComponentRendererRef(renderer);
  const ResolvedComponent = useColumnRenderer(componentRef?.name);
  if (typeof renderer === "function") {
    // 2. Argument: ganze Row als read-only — function-Renderer können
    // context-aware sein (Tier 2.7e-Eagerload nutzt das für _refs).
    const fn = renderer as (v: unknown, r?: Readonly<Record<string, unknown>>) => string;
    return fn(value, row);
  }
  if (componentRef !== undefined) {
    if (ResolvedComponent !== undefined) {
      return <ResolvedComponent value={value} row={row} column={{ field }} />;
    }
    // Renderer im Schema referenziert, aber client-side keine Map-Eintrag —
    // typischer Fall: clientFeatures.columnRenderers vergessen oder
    // Tippfehler im __component-Key. Warnen statt crashen, damit ein
    // Schema-Boot trotzdem funktioniert (Default-Type-Renderer übernimmt).
    // biome-ignore lint/suspicious/noConsole: dev-warning für Schema-Konflikte
    console.warn(`[kumiko] columnRenderer "${componentRef.name}" not registered`);
  }
  return defaultCellRender(value, type, optionLabels);
}

// ---- Form + Section + Grid + Text ----

function DefaultForm({ onSubmit, children, title, actions, testId }: FormProps): ReactNode {
  // Form ist full-width — main hat kein Padding, also fügen wir's hier
  // pro Bereich hinzu. Action-Bar bekommt h-12 + horizontal-px-6 und
  // klebt sticky am main-Top (ohne Negative-Margin-Tricks). Content
  // unten kriegt eigenes p-6 + max-w-2xl — schmaler als die volle
  // Sidebar-flankierte Breite, damit Zeilen nicht reißen und der
  // Single-Column-Linear-Look erhalten bleibt.
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(e);
      }}
      data-testid={testId}
      className="flex flex-col w-full"
    >
      {(title !== undefined || actions !== undefined) && (
        <div
          data-testid={testId !== undefined ? `${testId}-actions` : undefined}
          className="sticky top-0 z-10 h-12 px-6 bg-muted/30 border-b flex items-center gap-3"
        >
          {title !== undefined && (
            <div className="text-lg font-semibold tracking-tight truncate">{title}</div>
          )}
          {actions !== undefined && (
            <div className="flex items-center gap-2 ml-auto">{actions}</div>
          )}
        </div>
      )}
      <div className="px-6 pt-6 pb-12 max-w-2xl w-full flex flex-col gap-8">{children}</div>
    </form>
  );
}

function DefaultSection({ title, children, testId }: SectionProps): ReactNode {
  // Linear-Pattern: keine Card-Box, nur ein dezenter Section-Header
  // (uppercase, klein, muted) als Trennung. Sections fließen vertikal
  // im Form-Container; Visualität entsteht aus Whitespace + Typo, nicht
  // aus Border + Shadow. Spart Chrome und sieht weniger "boxy" aus.
  return (
    <section data-testid={testId} className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function DefaultGrid({ columns, children, testId }: GridProps): ReactNode {
  // Responsive: Mobile (< sm = 640px) bleibt 1-spaltig, ab sm: greift
  // die Author-deklarierte Spaltenzahl. Inline-style schreibt
  // CSS-Variable; Tailwind-Klasse liest die Variable mit
  // `grid-template-columns: var(--grid-cols)`. Saubere Lösung weil
  // Tailwind JIT keinen dynamischen `grid-cols-${N}` auflösen kann.
  return (
    <div
      data-testid={testId}
      className="grid gap-4 grid-cols-1 sm:[grid-template-columns:var(--grid-cols)]"
      style={{ "--grid-cols": `repeat(${columns}, minmax(0, 1fr))` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

function DefaultGridCell({ span, children }: GridCellProps): ReactNode {
  const s = span !== undefined ? Math.min(span, 12) : 1;
  return <div style={{ gridColumn: `span ${s}` }}>{children}</div>;
}

function DefaultText({ variant = "body", children, testId }: TextProps): ReactNode {
  switch (variant) {
    case "code":
      return (
        <code
          data-testid={testId}
          className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm"
        >
          {children}
        </code>
      );
    case "small":
      return (
        <small data-testid={testId} className="text-xs text-muted-foreground">
          {children}
        </small>
      );
    case "required-mark":
      return (
        <span data-testid={testId} data-required className="text-destructive">
          {children}
        </span>
      );
    default:
      return <span data-testid={testId}>{children}</span>;
  }
}

function DefaultHeading({ variant = "page", children, testId }: HeadingProps): ReactNode {
  // Page-Heading = h1, sehr selten in einer App (max 1 pro Screen).
  // Section-Heading = h2 mit uppercase + muted-foreground — derselbe
  // Look wie der Section-Header in Forms, aber als Standalone-Component
  // für Demo-Pages und Custom-Screens nutzbar.
  if (variant === "section") {
    return (
      <h2
        data-testid={testId}
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {children}
      </h2>
    );
  }
  return (
    <h1 data-testid={testId} className="text-2xl font-semibold tracking-tight">
      {children}
    </h1>
  );
}

import { ConfigCascadeView as DefaultConfigCascadeView } from "../components/config-cascade";
import { ConfigSourceBadge as DefaultConfigSourceBadge } from "../components/config-source-badge";

export const defaultPrimitives: CorePrimitives = {
  Button: DefaultButton,
  Banner: DefaultBanner,
  Field: DefaultField,
  Input: DefaultInput,
  DataTable: DefaultDataTable,
  Form: DefaultForm,
  Section: DefaultSection,
  Grid: DefaultGrid,
  GridCell: DefaultGridCell,
  Text: DefaultText,
  Heading: DefaultHeading,
  Dialog: DefaultDialog,
  ConfigSourceBadge: DefaultConfigSourceBadge,
  ConfigCascadeView: DefaultConfigCascadeView,
};
