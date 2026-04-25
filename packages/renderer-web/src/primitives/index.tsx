// shadcn+Tailwind Default-Primitives für den Web-Renderer.
// Konsumieren den Primitives-Contract aus `@kumiko/renderer`. Keine
// useTokens()-Aufrufe — die Farben kommen aus den Tailwind-Klassen
// die auf die shadcn-CSS-Variablen referenzieren.
//
// Muster: pro Primitive eine Tailwind-Klassen-Komposition,
// Konfigurierbarkeit über `class-variance-authority` für variant-
// basierte Stile. Radix-UI-Unterbau für interaktive Elemente (Modal,
// Dropdown etc. kommen später).

import type {
  BannerProps,
  ButtonProps,
  CorePrimitives,
  DataTableProps,
  FieldProps,
  FormProps,
  GridCellProps,
  GridProps,
  InputProps,
  SectionProps,
  TextProps,
} from "@kumiko/renderer";
import { cva } from "class-variance-authority";
import type { ChangeEvent, ReactNode } from "react";
import { cn } from "../lib/cn";

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
  variant = "primary",
  children,
  testId,
}: ButtonProps): ReactNode {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(buttonVariants({ variant }), "h-9 px-4 py-2")}
    >
      {children}
    </button>
  );
}

// ---- Banner (shadcn: Alert) ----

function DefaultBanner({ variant = "info", children, actions, testId }: BannerProps): ReactNode {
  const isError = variant === "error";
  return (
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
}

// ---- Field (Label + Error) ----

function DefaultField({ id, label, required, issues, children, testId }: FieldProps): ReactNode {
  const hasError = issues !== undefined && issues.length > 0;
  return (
    <div data-testid={testId} className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className={cn(
          "text-sm font-medium leading-none",
          hasError ? "text-destructive" : "text-foreground",
        )}
      >
        {label}
        {required === true && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {hasError && (
        <div
          role="alert"
          data-testid={testId !== undefined ? `${testId}-errors` : undefined}
          className="text-xs text-destructive"
        >
          {issues.map((issue) => (
            <div key={`${issue.path}:${issue.code}`}>{issue.i18nKey}</div>
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
          className={cn(inputClassBase, errorClass)}
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
        <input
          type="date"
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            props.onChange(e.target.value !== "" ? e.target.value : undefined)
          }
          className={cn(inputClassBase, errorClass)}
        />
      );
    case "select":
      // Native <select> — kein Radix-Dropdown weil shadcn-Select eine
      // SSR-/Portal-Komplexität mitbringt die für die Default-Variante
      // unverhältnismäßig wäre. Apps die ein gestyltes Custom-Dropdown
      // wollen, liefern eine eigene Input-Primitive über
      // PrimitivesProvider. Empty-Option als Placeholder wenn nicht-
      // required UND value=="" — sonst muss ein Eintrag gewählt sein.
      return (
        <select
          {...common}
          value={props.value}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => props.onChange(e.target.value)}
          className={cn(inputClassBase, errorClass)}
        >
          {props.required !== true && <option value="">—</option>}
          {props.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
  }
}

// ---- DataTable (shadcn: Table) ----

function DefaultDataTable({
  columns,
  rows,
  onRowClick,
  emptyState,
  testId,
}: DataTableProps): ReactNode {
  if (rows.length === 0) {
    return (
      <div
        data-testid={testId !== undefined ? `${testId}-empty` : "render-list-empty"}
        className="flex items-center justify-center rounded-md border border-dashed p-8 text-sm text-muted-foreground"
      >
        {emptyState ?? <span>No entries.</span>}
      </div>
    );
  }
  return (
    <div className="rounded-md border">
      <table data-testid={testId} className="w-full caption-bottom text-sm">
        <thead className="[&_tr]:border-b">
          <tr className="border-b transition-colors hover:bg-muted/50">
            {columns.map((col) => (
              <th
                key={col.field}
                data-testid={`column-${col.field}`}
                data-sortable={col.sortable === true ? true : undefined}
                className="h-10 px-4 text-left align-middle font-medium text-muted-foreground"
              >
                {col.label}
              </th>
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
                  {renderCell(row.values[col.field], col.type, col.renderer)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCell(value: unknown, type: string, renderer?: unknown): string {
  if (typeof renderer === "function") {
    const fn = renderer as (v: unknown) => string;
    return fn(value);
  }
  if (value === null || value === undefined) return "";
  if (type === "boolean") return value === true ? "✓" : "";
  return typeof value === "string" ? value : String(value);
}

// ---- Form + Section + Grid + Text ----

function DefaultForm({ onSubmit, children, testId }: FormProps): ReactNode {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(e);
      }}
      data-testid={testId}
      className="flex flex-col gap-6"
    >
      {children}
    </form>
  );
}

function DefaultSection({ title, children, testId }: SectionProps): ReactNode {
  return (
    <section
      data-testid={testId}
      className="rounded-lg border bg-card text-card-foreground shadow-sm"
    >
      <div className="px-6 py-4 border-b">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      </div>
      <div className="px-6 py-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function DefaultGrid({ columns, children, testId }: GridProps): ReactNode {
  // Dynamische Grid-Spalten über style-Attribute — Tailwind JIT kann
  // `grid-cols-${N}` nicht statisch auflösen weil der Scanner nur
  // Literal-Strings sieht. Für feste Spaltenzahlen könnte man
  // `grid-cols-2` etc. hardcoden; Kumikos Grid ist aber generisch.
  return (
    <div
      data-testid={testId}
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
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
};
