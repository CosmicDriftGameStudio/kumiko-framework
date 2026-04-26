// shadcn+Tailwind Default-Primitives für den Web-Renderer.
// Konsumieren den Primitives-Contract aus `@kumiko/renderer`. Keine
// useTokens()-Aufrufe — die Farben kommen aus den Tailwind-Klassen
// die auf die shadcn-CSS-Variablen referenzieren.
//
// Muster: pro Primitive eine Tailwind-Klassen-Komposition,
// Konfigurierbarkeit über `class-variance-authority` für variant-
// basierte Stile. Radix-UI-Unterbau für interaktive Elemente (Modal,
// Dropdown etc. kommen später).

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
} from "@kumiko/renderer";
import * as LabelPrimitive from "@radix-ui/react-label";
import type { DataTableSort, DataTableSortDir } from "@kumiko/renderer";
import { cva } from "class-variance-authority";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { cn } from "../lib/cn";
import { DateInput } from "./date-input";
import { DefaultDialog } from "./dialog";
import { MoneyInput } from "./money-input";
import { SelectInput } from "./select";

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

function DefaultField({ id, label, required, issues, children, testId }: FieldProps): ReactNode {
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
        {required === true && <span className="ml-0.5 text-destructive">*</span>}
      </LabelPrimitive.Root>
      {children}
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
    case "select":
      // shadcn-Style Select via @radix-ui/react-select. Trigger-Button
      // mit Chevron, Portal'd Popover-Content, Items mit Check-
      // Indicator. SelectInput kapselt das Radix-Setup damit
      // DefaultInput nicht mit Sub-Component-Imports zugemüllt wird.
      return (
        <SelectInput
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          options={props.options}
          {...(props.disabled !== undefined && { disabled: props.disabled })}
          {...(props.required !== undefined && { required: props.required })}
          {...(props.hasError !== undefined && { hasError: props.hasError })}
        />
      );
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
  testId,
}: DataTableProps): ReactNode {
  // Toolbar-Wrapper: gemeinsamer Container für Toolbar+Tabelle damit
  // beide visuell zusammengehören. Toolbar ist NICHT sticky — Lists
  // scrollen typischerweise mit dem Page-Container, nicht intern.
  // Sticky würde mit der Topbar konkurrieren.
  const content =
    rows.length === 0 ? (
      <div
        data-testid={testId !== undefined ? `${testId}-empty` : "render-list-empty"}
        className="flex flex-col items-center justify-center rounded-md border border-dashed p-12 text-sm text-muted-foreground gap-3"
      >
        {emptyState ?? <span>No entries.</span>}
      </div>
    ) : (
      <div className="rounded-md border">
        <table data-testid={testId} className="w-full caption-bottom text-sm">
          {tableInner(columns, rows, onRowClick, sort, onSortChange)}
        </table>
      </div>
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
          <div className="text-base font-semibold tracking-tight truncate">{toolbarTitle}</div>
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
): ReactNode {
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
                className="p-4 align-middle"
              >
                <DataTableCell
                  value={row.values[col.field]}
                  row={row.values}
                  field={col.field}
                  type={col.type}
                  renderer={col.renderer}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </>
  );
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
        className="h-10 px-4 text-left align-middle font-medium text-muted-foreground"
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
        <Icon
          className={cn(
            "size-3.5",
            active === undefined && "opacity-40",
          )}
          aria-hidden="true"
        />
      </button>
    </th>
  );
}

// 3-State-Toggle: kein Sort → asc → desc → kein Sort. Idiomatisch für
// Power-User-Listen wo "ich will die Server-Default-Order zurück" eine
// echte Aktion ist (statt unendlich asc↔desc zu togglen).
function nextSortState(
  current: DataTableSortDir | undefined,
  field: string,
): DataTableSort | null {
  if (current === undefined) return { field, dir: "asc" };
  if (current === "asc") return { field, dir: "desc" };
  return null;
}

// Type-guard für die `{ react: { __component: "Name" } }`-Form, in der
// PlatformComponent-Renderer im Schema serialisiert ankommen. Schemas
// reisen über die Wire (Server → Client), echte Component-Refs würden
// das brechen — der String-Key ist die SSoT.
function isComponentRendererRef(renderer: unknown): { readonly name: string } | undefined {
  if (renderer === null || typeof renderer !== "object") return undefined;
  const reactBranch = (renderer as { react?: unknown }).react;
  if (reactBranch === null || typeof reactBranch !== "object") return undefined;
  const component = (reactBranch as { __component?: unknown }).__component;
  if (typeof component !== "string" || component.length === 0) return undefined;
  return { name: component };
}

function defaultCellRender(value: unknown, type: string): string {
  if (value === null || value === undefined) return "";
  if (type === "boolean") return value === true ? "✓" : "";
  return typeof value === "string" ? value : String(value);
}

type DataTableCellProps = {
  readonly value: unknown;
  readonly row: Readonly<Record<string, unknown>>;
  readonly field: string;
  readonly type: string;
  readonly renderer?: unknown;
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
function DataTableCell({ value, row, field, type, renderer }: DataTableCellProps): ReactNode {
  const componentRef = isComponentRendererRef(renderer);
  const ResolvedComponent = useColumnRenderer(componentRef?.name);
  if (typeof renderer === "function") {
    const fn = renderer as (v: unknown) => string;
    return fn(value);
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
  return defaultCellRender(value, type);
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
            <div className="text-base font-semibold tracking-tight truncate">{title}</div>
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
};
