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
import { applyFormatSpec } from "@cosmicdrift/kumiko-headless";
import type {
  DataTableRowAction,
  DataTableRowActionMode,
  DataTableSort,
  DataTableSortDir,
} from "@cosmicdrift/kumiko-renderer";
import {
  type BannerProps,
  type ButtonProps,
  type CardProps,
  type CorePrimitives,
  type DataTableFacet,
  type DataTableProps,
  type FieldProps,
  type FormProps,
  type GridCellProps,
  type GridProps,
  type HeadingProps,
  type InputProps,
  type LinkProps,
  type SectionProps,
  type TextProps,
  useColumnRenderer,
  useTranslation,
  WriteFailedError,
} from "@cosmicdrift/kumiko-renderer";
import { cva } from "class-variance-authority";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/cn";
import { Badge } from "../ui/badge";
import { buttonVariants, Button as UiButton } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input as UiInput } from "../ui/input";
import { Label as UiLabel } from "../ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Textarea } from "../ui/textarea";
import { ComboboxInput } from "./combobox";
import { DateInput } from "./date-input";
import { DefaultDialog } from "./dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { FileUploadInput } from "./file-upload";
import { DefaultLightbox } from "./lightbox";
import { LocatedTimestampInput } from "./located-timestamp-input";
import { MoneyInput } from "./money-input";
import { TimestampInput } from "./timestamp-input";
import { useToast } from "./toast";

// ---- Card-Chrome (eine Definition für Form/Section/Card) ----

// Die eine Card-Surface. Maße (Padding/Radius/Shadow) kommen aus --card-*
// CSS-Tokens (Defaults in styles.css), damit eine App sie einmal zentral in
// ihrer styles.css überschreiben kann — wie die Farben. Radius-Variante:
// xl = Card/Screen-Fläche (Default, token-getrieben), lg = "innen"-Fläche.
const cardSurface = cva(
  "flex flex-col border bg-card text-card-foreground shadow-[var(--card-shadow)]",
  {
    variants: { radius: { xl: "rounded-[var(--card-radius)]", lg: "rounded-lg" } },
    defaultVariants: { radius: "xl" },
  },
);
const cardFooter = "flex items-center justify-end gap-2 px-[var(--card-padding)] py-4";
const cardFooterBorder = "border-t bg-muted/30";

// ---- Button (vendored shadcn ui/button) ----

// Contract-Variant → shadcn-Variant: secondary war schon immer der
// bordered-bg-background-Look = shadcns `outline`. primary→default,
// danger→destructive, link→link (kein BG, underline on hover).
const BUTTON_VARIANT = {
  primary: "default",
  secondary: "outline",
  danger: "destructive",
  link: "link",
} as const;

const BUTTON_SIZE = {
  sm: "sm",
  md: "default",
  icon: "icon",
} as const;

function DefaultButton({
  type = "button",
  onClick,
  disabled,
  loading,
  variant = "primary",
  size = "md",
  ariaLabel,
  width = "auto",
  children,
  testId,
}: ButtonProps): ReactNode {
  // link-Variant rendert text-artig (Inline-Link im Fließtext/Banner), nicht als
  // gepolsterte Fläche; width="full" streckt CTA-Buttons in Karten/Panels.
  const className =
    [variant === "link" ? "h-auto px-0 py-0" : "", width === "full" ? "w-full" : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <UiButton
      type={type}
      onClick={onClick}
      disabled={disabled === true || loading === true}
      data-testid={testId}
      data-loading={loading === true ? "true" : undefined}
      variant={BUTTON_VARIANT[variant]}
      size={BUTTON_SIZE[size]}
      {...(ariaLabel !== undefined && { "aria-label": ariaLabel })}
      className={className}
    >
      {loading === true ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : children}
    </UiButton>
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
  layout,
  testId,
}: FieldProps): ReactNode {
  const t = useTranslation();
  const hasError = issues !== undefined && issues.length > 0;
  const labelEl = (
    <UiLabel htmlFor={id} className={hasError ? "text-destructive" : "text-foreground"}>
      {label}
      {required === true && <span className="ml-0.5 text-destructive">*</span>}
    </UiLabel>
  );
  const errorsEl = hasError ? (
    <div
      role="alert"
      data-testid={testId !== undefined ? `${testId}-errors` : undefined}
      className="text-xs text-destructive"
    >
      {issues.map((issue) => (
        <div key={`${issue.path}:${issue.code}`}>{t(issue.i18nKey, issue.params)}</div>
      ))}
    </div>
  ) : null;

  // Inline (boolean/checkbox): Control links, Label rechts — shadcn-Muster.
  if (layout === "inline") {
    return (
      <div data-testid={testId} className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {children}
          {labelEl}
          {labelAppendix !== undefined && labelAppendix}
        </div>
        {errorsEl}
      </div>
    );
  }

  return (
    <div data-testid={testId} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        {labelEl}
        {/* appendix neben dem <label>, nicht darin — interaktiver Inhalt
            (Disclosure-Button) gehört nicht in ein label-Element. */}
        {labelAppendix !== undefined && labelAppendix}
      </div>
      {/* fieldAppendix (Cascade-Detail-Panel) über dem Input — das
          aufgeklappte Detail gehört direkt unter seinen Trigger in der
          Label-Row, nicht durch den Input davon getrennt. */}
      {fieldAppendix !== undefined && fieldAppendix}
      {children}
      {errorsEl}
    </div>
  );
}

// ---- Input ----

function DefaultInput(props: InputProps): ReactNode {
  // Vendored ui/input + ui/checkbox stylen Fehler über `aria-invalid`
  // selbst — kein manuelles border-destructive mehr nötig.
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
        <UiInput
          type="text"
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
          {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
          {...(props.autoComplete !== undefined && { autoComplete: props.autoComplete })}
        />
      );
    case "email":
      return (
        <UiInput
          type="email"
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
          {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
          autoComplete={props.autoComplete ?? "email"}
        />
      );
    case "password":
      return (
        <UiInput
          type="password"
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
          autoComplete={props.autoComplete ?? "current-password"}
        />
      );
    case "number":
      return (
        <UiInput
          type="number"
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const v = e.target.value;
            props.onChange(v === "" ? undefined : Number(v));
          }}
          className="text-right tabular-nums"
        />
      );
    case "range":
      return (
        <input
          type="range"
          {...common}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(Number(e.target.value))}
          className="w-full accent-primary"
        />
      );
    case "boolean":
      return (
        <Checkbox
          id={props.id}
          name={props.name}
          disabled={props.disabled}
          aria-required={props.required}
          aria-invalid={props.hasError === true ? true : undefined}
          checked={props.value}
          onCheckedChange={(checked) => props.onChange(checked === true)}
        />
      );
    case "file":
    case "image":
      return (
        <FileUploadInput
          kind={props.kind}
          id={props.id}
          value={props.value}
          onChange={props.onChange}
          {...(props.accept !== undefined && { accept: props.accept })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.entityType !== undefined && { entityType: props.entityType })}
          {...(props.fieldName !== undefined && { fieldName: props.fieldName })}
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
          {...(props.min !== undefined && { min: props.min })}
          {...(props.max !== undefined && { max: props.max })}
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
        <TimestampInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          {...(props.wallClock !== undefined && { wallClock: props.wallClock })}
          {...(props.locale !== undefined && { locale: props.locale })}
          {...(props.min !== undefined && { min: props.min })}
          {...(props.max !== undefined && { max: props.max })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    case "locatedTimestamp":
      return (
        <LocatedTimestampInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          {...(props.locale !== undefined && { locale: props.locale })}
          {...(props.min !== undefined && { min: props.min })}
          {...(props.max !== undefined && { max: props.max })}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
    case "textarea":
      return (
        <Textarea
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => props.onChange(e.target.value)}
          rows={props.rows ?? 4}
          className="resize-y"
        />
      );
  }
}

// ---- DataTable (shadcn: Table) ----

// Faceted-Filter-Dropdown: Outline-Button (wie shadcns "Columns"-Toggle) +
// Multi-Select-Checkboxen. Aktive Auswahl → Count-Badge am Button.
function FacetFilter({
  facet,
  selected,
  onChange,
}: {
  facet: DataTableFacet;
  selected: readonly string[];
  onChange: (field: string, values: readonly string[]) => void;
}): ReactNode {
  const toggle = (value: string, checked: boolean): void => {
    const next = checked ? [...selected, value] : selected.filter((v) => v !== value);
    onChange(facet.field, next);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <UiButton variant="outline" size="sm" className="h-9" data-testid={`facet-${facet.field}`}>
          {facet.label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-1 rounded-sm px-1 font-normal tabular-nums">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="text-muted-foreground" />
        </UiButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {facet.options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={selected.includes(opt.value)}
            onCheckedChange={(checked: boolean) => toggle(opt.value, checked)}
            onSelect={(e: Event) => e.preventDefault()}
            data-testid={`facet-${facet.field}-${opt.value}`}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DefaultDataTable({
  columns,
  rows,
  onRowClick,
  sort,
  onSortChange,
  emptyState,
  toolbarStart,
  toolbarEnd,
  pager,
  onReachEnd,
  loadingMore,
  hasMore,
  rowActions,
  rowActionMode,
  filterFacets,
  filterValues,
  onFilterChange,
  onFilterReset,
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
      // dashboard-01-Muster: `rounded-lg border`-Rahmen, die Header-Zeile
      // trägt den bg-muted-Grauton. `bg-card` (statt transparent) → die Liste
      // sitzt auf derselben Card-Fläche wie Forms; auf Themes mit farbigem
      // Page-Background (z.B. Cream) matchen Listen sonst nicht die Cards.
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table data-testid={testId}>
          {tableInner(columns, rows, onRowClick, sort, onSortChange, rowActions, rowActionMode)}
        </Table>
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

  const hasFacets =
    filterFacets !== undefined && filterFacets.length > 0 && onFilterChange !== undefined;
  const hasActiveFilters =
    filterValues !== undefined && Object.values(filterValues).some((v) => v.length > 0);
  const facetCluster = hasFacets ? (
    <div className="flex items-center gap-2">
      {filterFacets.map((facet) => (
        <FacetFilter
          key={facet.field}
          facet={facet}
          selected={filterValues?.[facet.field] ?? []}
          onChange={onFilterChange}
        />
      ))}
      {hasActiveFilters && onFilterReset !== undefined && (
        <UiButton
          variant="ghost"
          size="sm"
          className="h-9 px-2"
          onClick={onFilterReset}
          data-testid="facet-reset"
        >
          Reset
          <X />
        </UiButton>
      )}
    </div>
  ) : undefined;

  const hasToolbar =
    toolbarStart !== undefined || toolbarEnd !== undefined || facetCluster !== undefined;

  // dashboard-01-Muster: die Toolbar (Search + Facets + "+ Neu") sitzt ÜBER
  // der Tabelle im selben Padding-Block — kein separater bg-Bar, kein Screen-
  // Titel (der steht im Breadcrumb der Shell).
  return (
    <div className="flex flex-col gap-4 p-6 w-full">
      {hasToolbar && (
        <div
          data-testid={testId !== undefined ? `${testId}-toolbar` : "render-list-toolbar"}
          className="flex items-center gap-3"
        >
          {toolbarStart !== undefined && <div className="flex-1 max-w-sm">{toolbarStart}</div>}
          {facetCluster}
          {toolbarEnd !== undefined && (
            <div className="flex items-center gap-2 ml-auto">{toolbarEnd}</div>
          )}
        </div>
      )}
      {content}
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
  rowActionMode?: DataTableProps["rowActionMode"],
): ReactNode {
  const hasActions = rowActions !== undefined && rowActions.length > 0;
  return (
    <>
      <TableHeader className="bg-muted">
        <TableRow className="hover:bg-transparent">
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
            <TableHead
              data-testid="column-actions"
              // sticky right-0 + bg-muted (= Header-Ton) damit die Action-
              // Spalte beim horizontalen Scroll am rechten Rand bleibt. Kein
              // border-l: der ständige Trenner wirkt schwer; die sticky-bg
              // grenzt die Spalte beim Scroll ohnehin ab.
              className="sticky right-0 z-10 w-px bg-muted text-right text-muted-foreground"
              aria-label="Actions"
            />
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            data-testid={`row-${row.id}`}
            onClick={onRowClick !== undefined ? () => onRowClick(row) : undefined}
            className={cn(onRowClick !== undefined && "cursor-pointer")}
          >
            {columns.map((col) => (
              <TableCell
                key={col.field}
                data-testid={`cell-${row.id}-${col.field}`}
                // Cells truncaten lange Werte mit ellipsis statt umzu-
                // brechen — Lists bleiben einzeilig + scannbar (Linear-
                // Pattern). max-w-xs gibt eine vernünftige Default-
                // Obergrenze; der Table-Container scrollt horizontal
                // falls die Summe der Spalten zu breit wird.
                className="max-w-xs truncate"
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
              </TableCell>
            ))}
            {hasActions && (
              <TableCell
                data-testid={`cell-${row.id}-actions`}
                // Sticky-right damit beim horizontalen Scroll die Actions
                // am rechten Rand sichtbar bleiben. bg-background grenzt die
                // Spalte beim Scroll ab — kein border-l (Trenner zu schwer).
                className="sticky right-0 z-10 bg-background text-right"
                // Action-Cell-Events dürfen nicht den Row-Click/Activation
                // triggern (typisch "Open Detail" — der User wollte ja die
                // Action, nicht navigieren). Wir stopPropagation für Mouse
                // UND Keyboard, damit a11y konsistent ist.
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <RowActionsCell row={row} actions={rowActions} mode={rowActionMode} />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </>
  );
}

// RowActionsCell — rendert die Row-Actions je nach mode:
//   - "adaptive" (Default): ≤2 sichtbare Actions inline (rechtsbündig),
//     >2 als Kebab-Dropdown.
//   - "inline": IMMER Inline-Buttons, linksbündig + full-width — auch bei
//     >2 (kein Kebab). `w-full justify-start` heftet den ersten Button an
//     die Spalten-Linkskante, damit er über alle Rows an derselben Position
//     steht (sonst wandert er durch unterschiedlich breite Labels).
// isVisible-Filter wird hier ausgeführt; eine action die für eine Row
// unsichtbar ist, kommt nicht in den Render. Sind alle Actions hidden,
// bleibt die Cell leer (keine Phantom-Spalte).
function RowActionsCell({
  row,
  actions,
  mode = "adaptive",
}: {
  readonly row: ListRowViewModel;
  readonly actions: readonly DataTableRowAction[];
  readonly mode?: DataTableRowActionMode;
}): ReactNode {
  const visible = actions.filter((a) => a.isVisible === undefined || a.isVisible(row));
  if (visible.length === 0) return null;
  if (mode === "inline") {
    return (
      <div className="flex w-full items-center gap-1 justify-start">
        {visible.map((a) => (
          <RowActionButton key={a.id} row={row} action={a} />
        ))}
      </div>
    );
  }
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
  const { toast } = useToast();
  const t = useTranslation();
  const triggerNow = async (action: DataTableRowAction): Promise<void> => {
    setBusy(true);
    try {
      await action.onTrigger(row);
    } catch (e) {
      // Surfacing statt schlucken: ein verschluckter Write-Fehler sah für
      // den User wie "nichts passiert" aus (Prod-Bug 2026-06-07).
      const docsUrl = e instanceof WriteFailedError ? e.dispatcherError.docsUrl : undefined;
      toast({
        title: t("kumiko.rowAction.failed"),
        description: e instanceof Error ? e.message : String(e),
        variant: "bad",
        ...(docsUrl !== undefined && { docsUrl }),
      });
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
      <TableHead
        data-testid={`column-${field}`}
        data-sortable={sortable === true ? true : undefined}
        className="px-4 text-muted-foreground"
      >
        {label}
      </TableHead>
    );
  }

  const Icon = active?.dir === "asc" ? ArrowUp : active?.dir === "desc" ? ArrowDown : ArrowUpDown;
  const next = nextSortState(active?.dir, field);

  return (
    <TableHead
      data-testid={`column-${field}`}
      data-sortable="true"
      aria-sort={ariaSort}
      className="px-4 text-muted-foreground"
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
    </TableHead>
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

// applyFormatSpec re-exported from headless (platform-agnostic).
export { applyFormatSpec };

// Type-spezifische Default-Cell-Renderer. Author kann pro Spalte einen
// expliziten renderer setzen (FormatSpec oder PlatformComponent); ohne
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
  if (type === "timestamp" || type === "date") return applyFormatSpec({ format: type }, value);
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
// useColumnRenderer-Hook aus dem Provider lesen kann. Die vier Pfade:
//   1. FormatSpec (`{ format: "timestamp" }` etc.) → applyFormatSpec.
//   2. RuntimeRenderer (Funktion) → direkter Aufruf. Nur für render-list-
//      interne Reference-Lookup-Closures — niemals aus dem serialisierten Schema.
//   3. PlatformComponent (`{ react: { __component: "X" } }`) → schaut
//      "X" über useColumnRenderer auf und rendert `<X value row column/>`.
//      Nicht registriert → einmalige Warnung + Default-Fallback.
//   4. Sonst → defaultCellRender (Type-basierter String-Renderer).
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
  if (typeof renderer === "object" && renderer !== null && "format" in renderer) {
    return applyFormatSpec(renderer as { format: string } & Record<string, unknown>, value);
  }
  if (typeof renderer === "function") {
    const fn = renderer as (v: unknown, r?: Readonly<Record<string, unknown>>) => string;
    return fn(value, row);
  }
  if (componentRef !== undefined) {
    if (ResolvedComponent !== undefined) {
      return <ResolvedComponent value={value} row={row} column={{ field }} />;
    }
    // Renderer im Schema referenziert, aber client-side kein Map-Eintrag —
    // typischer Fall: clientFeatures.columnRenderers vergessen oder
    // Tippfehler im __component-Key. Warnen statt crashen, damit ein
    // Schema-Boot trotzdem funktioniert (Default-Type-Renderer übernimmt).
    // biome-ignore lint/suspicious/noConsole: dev-warning für Schema-Konflikte
    console.warn(`[kumiko] columnRenderer "${componentRef.name}" not registered`);
  }
  // select-Werte als neutrale Badge-Pill (shadcn secondary) statt Plain-Text.
  // Farbige Status-Semantik (grün/amber) bleibt App-Sache via columnRenderer.
  if (type === "select" && value !== null && value !== undefined && value !== "") {
    // dashboard-01-Muster: outline-Badge + muted statt gefülltem secondary.
    return (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        {defaultCellRender(value, type, optionLabels)}
      </Badge>
    );
  }
  return defaultCellRender(value, type, optionLabels);
}

// ---- Form + Section + Grid + Text ----

// Setzt DefaultSection in den Inner-Region-Modus: das ganze Form ist EINE
// Card, Sections sind divider-getrennte Abschnitte darin (shadcn-Muster wie
// Shipping/Invoice/Profile). Standalone (außerhalb Form) bleibt Section eine
// eigene Card.
const InsideFormContext = createContext(false);

// Eingebettete Forms (z.B. im AuthCard) tragen ihre Card-Fläche schon vom
// Container — der self-cardende DefaultForm würde sonst eine Card-in-Card
// erzeugen. BareFormProvider schaltet DefaultForm auf ein nacktes <form>
// (gestapelte Felder, kein eigener Rahmen/max-width).
const BareFormContext = createContext(false);

export function BareFormProvider({ children }: { children: ReactNode }): ReactNode {
  return <BareFormContext.Provider value={true}>{children}</BareFormContext.Provider>;
}

function DefaultForm({
  onSubmit,
  children,
  title,
  subtitle,
  actions,
  testId,
}: FormProps): ReactNode {
  // Eingebettet (AuthCard etc.): nacktes <form>, gestapelte Felder mit gap —
  // der Container trägt Card/Titel selbst, sonst Card-in-Card.
  if (useContext(BareFormContext)) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(e);
        }}
        data-testid={testId}
        className="flex flex-col gap-4"
      >
        <InsideFormContext.Provider value={true}>{children}</InsideFormContext.Provider>
        {actions !== undefined && (
          <div className="flex items-center justify-end gap-2">{actions}</div>
        )}
      </form>
    );
  }

  // shadcn-Form-Muster: das Formular ist EINE Card — Titel als Card-Header
  // OHNE Trennlinie darunter (Titel fließt in die erste Section). Sections
  // sind divide-y-getrennt (Linien nur ZWISCHEN ihnen). Action-Footer mit
  // bg-muted/30 als Farb-Trenner statt harter Linie. main hat kein Padding;
  // der max-w-3xl-Body rahmt die Card, mx-auto zentriert ihn im Main statt
  // linksbündig (sonst „eingesperrt" mit leerer rechter Hälfte auf breiten
  // Screens).
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(e);
      }}
      data-testid={testId}
      className="flex flex-col w-full"
    >
      <FormScreenShell>
        <div className={cn(cardSurface(), "overflow-hidden")}>
          {(title !== undefined || subtitle !== undefined) && (
            <div className="px-6 pb-2 pt-5">
              {title !== undefined && (
                <h2
                  data-testid={testId !== undefined ? `${testId}-title` : undefined}
                  className="text-lg font-semibold tracking-tight"
                >
                  {title}
                </h2>
              )}
              {subtitle !== undefined && (
                <p
                  data-testid={testId !== undefined ? `${testId}-subtitle` : undefined}
                  className="mt-1 text-sm text-muted-foreground"
                >
                  {subtitle}
                </p>
              )}
            </div>
          )}
          <div
            className={cn(
              "flex flex-col",
              // Section-Children (Auto-UI-Edit) trennt eine Linie ZWISCHEN
              // ihnen — sie padden sich selbst. Flache Felder (Custom-Screens)
              // kriegen Padding + Rhythmus, keine Linie zwischen jedem Feld.
              "[&>section:not(:first-child)]:border-t",
              "[&>:not(section)]:px-6 [&>:not(section)]:py-3",
              "[&>:not(section):first-child]:pt-6 [&>:not(section):last-child]:pb-6",
            )}
          >
            <InsideFormContext.Provider value={true}>{children}</InsideFormContext.Provider>
          </div>
          {actions !== undefined && (
            <div
              data-testid={testId !== undefined ? `${testId}-actions` : undefined}
              className={cn(cardFooter, cardFooterBorder)}
            >
              {actions}
            </div>
          )}
        </div>
      </FormScreenShell>
    </form>
  );
}

// Kanonische Form/Settings-Shell: zentrierte Spalte mit Standard-Screen-
// Padding. DefaultForm (configEdit/entityEdit) UND custom Settings-Screens
// (url-settings, privacy-center) teilen sie → einheitliche Breite +
// Zentrierung statt per-Screen-Wildwuchs. Breite über `maxWidth`-Intent statt
// beliebiger max-w-*-Overrides: sm=schmale Auth-Forms, 3xl=Standard-Detail,
// 4xl=tabellen-nahe Forms, full=volle Breite. Inhalt nutzt Card-Primitives;
// `className` (z.B. "flex flex-col gap-6") für Multi-Card-Stacks.
export type FormScreenShellWidth = "sm" | "3xl" | "4xl" | "full";

const formScreenShellWidth: Record<FormScreenShellWidth, string> = {
  sm: "max-w-sm mx-auto",
  "3xl": "max-w-3xl mx-auto",
  "4xl": "max-w-4xl mx-auto",
  full: "max-w-full",
};

export function FormScreenShell({
  children,
  className,
  testId,
  maxWidth = "3xl",
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
  readonly maxWidth?: FormScreenShellWidth;
}): ReactNode {
  return (
    <div
      data-testid={testId}
      className={cn("px-6 pt-6 pb-12 w-full", formScreenShellWidth[maxWidth], className)}
    >
      {children}
    </div>
  );
}

function DefaultSection({ title, subtitle, children, actions, testId }: SectionProps): ReactNode {
  const insideForm = useContext(InsideFormContext);

  // h3 statt CardTitle (= div): erhält die Heading-Semantik für
  // Screenreader-Navigation. Subtitle fließt darunter (kein Divider —
  // shadcn CardTitle+CardDescription-Muster).
  const header =
    title !== undefined || subtitle !== undefined ? (
      <div className="flex flex-col gap-1">
        {title !== undefined && (
          <h3
            data-testid={testId !== undefined ? `${testId}-title` : undefined}
            className="text-base font-semibold leading-none tracking-tight"
          >
            {title}
          </h3>
        )}
        {subtitle !== undefined && (
          <div
            data-testid={testId !== undefined ? `${testId}-subtitle` : undefined}
            className="text-sm text-muted-foreground"
          >
            {subtitle}
          </div>
        )}
      </div>
    ) : null;

  // Innerhalb eines Forms: divider-loser Abschnitt OHNE eigene Card-Fläche.
  // Die Trennlinien ZWISCHEN Sections macht der divide-y-Wrapper im Form.
  // actions hier = rechtsbündige Reihe (das Form trägt den eigenen Footer).
  if (insideForm) {
    return (
      <section data-testid={testId} className="flex flex-col gap-4 px-6 py-6">
        {header}
        {children}
        {actions !== undefined && (
          <div
            data-testid={testId !== undefined ? `${testId}-actions` : undefined}
            className="flex items-center justify-end gap-2"
          >
            {actions}
          </div>
        )}
      </section>
    );
  }

  // Standalone: eigene Card, Header fließt in den Body (kein Divider).
  // actions = abgehobene Footer-Row (border-t bg-muted/30, wie DefaultForm).
  // overflow-hidden clips the footer-corner radius correctly for portaled
  // overlays (Combobox/Select/Tooltip escape to document.body, unaffected).
  // A non-portaled overlay (e.g. a custom dropdown built directly into
  // `children`) WOULD get silently clipped — verify this against any new
  // standalone-section content that renders its own non-portaled overlay.
  return (
    <div data-testid={testId} className={cn(cardSurface(), "overflow-hidden")}>
      <div className="flex flex-col gap-4 px-6 py-6">
        {header}
        {children}
      </div>
      {actions !== undefined && (
        <div
          data-testid={testId !== undefined ? `${testId}-actions` : undefined}
          className={cn(cardFooter, cardFooterBorder)}
        >
          {actions}
        </div>
      )}
    </div>
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
      // workaround: duplicate @types/react instances break direct CSSProperties cast
      style={{ "--grid-cols": `repeat(${columns}, minmax(0, 1fr))` } as unknown as CSSProperties}
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
    case "muted":
      return (
        <span data-testid={testId} className="text-sm text-muted-foreground">
          {children}
        </span>
      );
    default:
      return <span data-testid={testId}>{children}</span>;
  }
}

// ---- Link (anchor mit Button-/Muted-Optik) ----

// `button` nutzt die Primary-Buttonfläche auf einem semantischen <a> —
// der Standard für „weiter zu"-Navigationen nach Success-States (ehem.
// authButtonClass), `muted` der dezente Sekundär-Link (ehem.
// authMutedLinkClass).
function DefaultLink({
  href,
  variant = "default",
  target,
  className,
  children,
  testId,
}: LinkProps): ReactNode {
  const variantClass =
    variant === "button"
      ? buttonVariants({ variant: "default" })
      : variant === "muted"
        ? "text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        : "text-primary underline-offset-4 hover:underline";
  return (
    <a
      href={href}
      target={target}
      rel={target === "_blank" ? "noreferrer" : undefined}
      data-testid={testId}
      className={cn(variantClass, className)}
    >
      {children}
    </a>
  );
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

// Generische Card-Chrome (rounded-xl wie die Entity-Card) — slot- + options-
// basiert, damit der Contract additiv wächst und Consumer nie migriert werden.
export function DefaultCard({ slots, options, className, testId, children }: CardProps): ReactNode {
  const padded = options?.padded ?? true;
  const radius = options?.radius ?? "xl";
  const footerBordered = options?.footerBordered ?? true;
  const s = slots ?? {};
  const defaultHeader =
    s.title !== undefined || s.subtitle !== undefined || s.headerActions !== undefined ? (
      <div className="flex flex-wrap items-start justify-between gap-3 px-[var(--card-padding)] pt-6 pb-4">
        <div className="flex flex-col gap-1">
          {s.title !== undefined && (
            <h3 className="text-base font-semibold leading-none tracking-tight">{s.title}</h3>
          )}
          {s.subtitle !== undefined && (
            <p className="text-sm text-muted-foreground">{s.subtitle}</p>
          )}
        </div>
        {s.headerActions}
      </div>
    ) : null;
  const header = s.header ?? defaultHeader;
  const hasHeader = header !== null && header !== undefined;
  return (
    <div data-testid={testId} className={cn(cardSurface({ radius }), "overflow-hidden", className)}>
      {header}
      {/* != null covers undefined AND explicit null; a `false` child (from
          `cond && <El/>`) still renders no visible content either way. */}
      {children != null && (
        <div
          className={cn(
            "grow",
            padded &&
              (hasHeader
                ? "px-[var(--card-padding)] pb-[var(--card-padding)]"
                : "p-[var(--card-padding)]"),
          )}
        >
          {children}
        </div>
      )}
      {s.footer !== undefined && (
        <div className={cn(cardFooter, footerBordered && cardFooterBorder)}>{s.footer}</div>
      )}
    </div>
  );
}

export const defaultPrimitives: CorePrimitives = {
  Button: DefaultButton,
  Banner: DefaultBanner,
  Field: DefaultField,
  Input: DefaultInput,
  DataTable: DefaultDataTable,
  Form: DefaultForm,
  Section: DefaultSection,
  Card: DefaultCard,
  Grid: DefaultGrid,
  GridCell: DefaultGridCell,
  Text: DefaultText,
  Heading: DefaultHeading,
  Dialog: DefaultDialog,
  Lightbox: DefaultLightbox,
  ConfigSourceBadge: DefaultConfigSourceBadge,
  ConfigCascadeView: DefaultConfigCascadeView,
  Link: DefaultLink,
};
