// HTML-Default-Primitives für den Web-Renderer. Konsumiert den
// Primitives-Contract aus `@kumiko/renderer` und liefert eine
// `defaultPrimitives`-Registry die die Plain-HTML-Tags rendert —
// unstyled. Apps die ein Design-System haben, überschreiben einzelne
// Primitives via createKumikoApp({ primitives: { Banner: MyBanner } }).

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
import type { ChangeEvent, ReactNode } from "react";

function DefaultButton({
  type = "button",
  onClick,
  disabled,
  children,
  testId,
}: ButtonProps): ReactNode {
  return (
    <button type={type} onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  );
}

function DefaultBanner({ variant = "info", children, actions, testId }: BannerProps): ReactNode {
  // Nur role=alert bei echten Errors — Loading-States sollen keine
  // Screenreader-Alerts feuern.
  const role = variant === "error" ? "alert" : undefined;
  return (
    <div data-testid={testId} role={role} data-variant={variant}>
      <span>{children}</span>
      {actions !== undefined && <span data-slot="actions">{actions}</span>}
    </div>
  );
}

function DefaultField({ id, label, required, issues, children, testId }: FieldProps): ReactNode {
  return (
    <div data-testid={testId}>
      <label htmlFor={id}>
        {label}
        {required === true && <span data-required>{" *"}</span>}
      </label>
      {children}
      {issues !== undefined && issues.length > 0 && (
        <div role="alert" data-testid={testId !== undefined ? `${testId}-errors` : undefined}>
          {issues.map((issue) => (
            <div key={`${issue.path}:${issue.code}`}>{issue.i18nKey}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function DefaultInput(props: InputProps): ReactNode {
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
        />
      );
    case "boolean":
      return (
        <input
          type="checkbox"
          {...common}
          checked={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.checked)}
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
        />
      );
  }
}

function DefaultDataTable({
  columns,
  rows,
  onRowClick,
  emptyState,
  testId,
}: DataTableProps): ReactNode {
  if (rows.length === 0) {
    return (
      <div data-testid={testId !== undefined ? `${testId}-empty` : "render-list-empty"}>
        {emptyState ?? <span>No entries.</span>}
      </div>
    );
  }
  return (
    <table data-testid={testId}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.field}
              data-testid={`column-${col.field}`}
              data-sortable={col.sortable === true ? true : undefined}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            data-testid={`row-${row.id}`}
            onClick={onRowClick !== undefined ? () => onRowClick(row) : undefined}
            style={onRowClick !== undefined ? { cursor: "pointer" } : undefined}
          >
            {columns.map((col) => (
              <td key={col.field} data-testid={`cell-${row.id}-${col.field}`}>
                {renderCell(row.values[col.field], col.type, col.renderer)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Cell-Formatter. Inline-function renderers aus dem ScreenDefinition
// werden hier aufgerufen; booleans zeigen ✓ statt true/false; null/
// undefined → leer.
function renderCell(value: unknown, type: string, renderer?: unknown): string {
  if (typeof renderer === "function") {
    const fn = renderer as (v: unknown) => string;
    return fn(value);
  }
  if (value === null || value === undefined) return "";
  if (type === "boolean") return value === true ? "✓" : "";
  return typeof value === "string" ? value : String(value);
}

function DefaultForm({ onSubmit, children, testId }: FormProps): ReactNode {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(e);
      }}
      data-testid={testId}
    >
      {children}
    </form>
  );
}

function DefaultSection({ title, children, testId }: SectionProps): ReactNode {
  return (
    <fieldset data-testid={testId}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function DefaultGrid({ columns, children, testId }: GridProps): ReactNode {
  return (
    <div
      data-testid={testId}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: "12px",
      }}
    >
      {children}
    </div>
  );
}

function DefaultGridCell({ span, children }: GridCellProps): ReactNode {
  const s = span !== undefined ? span : 1;
  return <div style={{ gridColumn: `span ${s}` }}>{children}</div>;
}

function DefaultText({ variant = "body", children, testId }: TextProps): ReactNode {
  switch (variant) {
    case "code":
      return <code data-testid={testId}>{children}</code>;
    case "small":
      return <small data-testid={testId}>{children}</small>;
    case "required-mark":
      return (
        <span data-testid={testId} data-required>
          {children}
        </span>
      );
    default:
      return <span data-testid={testId}>{children}</span>;
  }
}

// CorePrimitives-Default — der Web-Renderer garantiert dass alle
// Kumiko-Core-Primitives verfügbar sind. App-Primitives kommen per
// Augmentation und werden in createKumikoApp zu defaultPrimitives
// dazugemerged.
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
