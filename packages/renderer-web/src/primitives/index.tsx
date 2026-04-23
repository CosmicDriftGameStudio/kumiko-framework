// HTML-Default-Primitives für den Web-Renderer. Konsumieren direkt
// CSS-Variables (`var(--kumiko-*)`) statt `useTokens()` — der Toggle
// läuft dann über einen einzigen `applyTokensToCssVars`-Aufruf,
// ohne Re-Renders in der Primitives-Cascade.
//
// `useTokens()` bleibt öffentliche API für App-Code der JS-Werte
// braucht (Canvas, Chart-Farben). Die Default-Primitives brauchen
// das nicht — sie rendern CSS, und CSS liest die Variables zur
// Render-Zeit vom Browser.

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
import type { ChangeEvent, CSSProperties, ReactNode } from "react";

// CSS-Variable Namen zentral. Entsprechen dem auto-generierten
// Namensschema von applyTokensToCssVars: `color.primary.background`
// → `--kumiko-color-primary-background` (camelCase → kebab,
// verschachtelte Objekte durch Bindestrich getrennt).
const css = {
  bg: "var(--kumiko-color-background)",
  surface: "var(--kumiko-color-surface)",
  text: "var(--kumiko-color-text)",
  textMuted: "var(--kumiko-color-text-muted)",
  border: "var(--kumiko-color-border)",
  primaryBg: "var(--kumiko-color-primary-background)",
  primaryText: "var(--kumiko-color-primary-text)",
  dangerBg: "var(--kumiko-color-danger-background)",
  dangerText: "var(--kumiko-color-danger-text)",
  xs: "var(--kumiko-spacing-xs)",
  sm: "var(--kumiko-spacing-sm)",
  md: "var(--kumiko-spacing-md)",
  lg: "var(--kumiko-spacing-lg)",
  radiusSm: "var(--kumiko-radius-sm)",
  radiusMd: "var(--kumiko-radius-md)",
  fontBody: "var(--kumiko-font-size-body)",
  fontSmall: "var(--kumiko-font-size-small)",
} as const;

function DefaultButton({
  type = "button",
  onClick,
  disabled,
  variant = "primary",
  children,
  testId,
}: ButtonProps): ReactNode {
  const style: CSSProperties = {
    background:
      variant === "secondary" ? "transparent" : variant === "danger" ? css.dangerBg : css.primaryBg,
    color:
      variant === "secondary" ? css.text : variant === "danger" ? css.dangerText : css.primaryText,
    border: variant === "secondary" ? `1px solid ${css.border}` : "none",
    padding: `${css.sm} ${css.md}`,
    borderRadius: css.radiusSm,
    fontSize: css.fontBody,
    cursor: disabled === true ? "not-allowed" : "pointer",
    opacity: disabled === true ? 0.5 : 1,
    marginRight: css.sm,
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} data-testid={testId} style={style}>
      {children}
    </button>
  );
}

function DefaultBanner({ variant = "info", children, actions, testId }: BannerProps): ReactNode {
  const role = variant === "error" ? "alert" : undefined;
  const bg =
    variant === "error" ? `color-mix(in srgb, ${css.dangerBg} 12%, transparent)` : css.surface;
  const borderColor = variant === "error" ? css.dangerBg : css.border;
  const style: CSSProperties = {
    display: "flex",
    gap: css.md,
    alignItems: "center",
    padding: `${css.sm} ${css.md}`,
    margin: `${css.sm} 0`,
    background: bg,
    border: `1px solid ${borderColor}`,
    borderRadius: css.radiusSm,
    fontSize: css.fontBody,
  };
  return (
    <div data-testid={testId} role={role} data-variant={variant} style={style}>
      <span style={{ flex: 1 }}>{children}</span>
      {actions !== undefined && <span data-slot="actions">{actions}</span>}
    </div>
  );
}

function DefaultField({ id, label, required, issues, children, testId }: FieldProps): ReactNode {
  const labelStyle: CSSProperties = {
    display: "block",
    fontSize: css.fontSmall,
    color: css.textMuted,
    marginBottom: css.xs,
  };
  const errorStyle: CSSProperties = {
    fontSize: css.fontSmall,
    color: css.dangerBg,
    marginTop: css.xs,
  };
  return (
    <div data-testid={testId}>
      <label htmlFor={id} style={labelStyle}>
        {label}
        {required === true && <span data-required>{" *"}</span>}
      </label>
      {children}
      {issues !== undefined && issues.length > 0 && (
        <div
          role="alert"
          data-testid={testId !== undefined ? `${testId}-errors` : undefined}
          style={errorStyle}
        >
          {issues.map((issue) => (
            <div key={`${issue.path}:${issue.code}`}>{issue.i18nKey}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function DefaultInput(props: InputProps): ReactNode {
  const baseStyle: CSSProperties = {
    width: "100%",
    padding: `${css.sm} ${css.md}`,
    background: css.bg,
    color: css.text,
    border: `1px solid ${props.hasError === true ? css.dangerBg : css.border}`,
    borderRadius: css.radiusSm,
    fontSize: css.fontBody,
    fontFamily: "inherit",
    boxSizing: "border-box",
  };
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
          style={baseStyle}
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
          style={baseStyle}
        />
      );
    case "boolean":
      return (
        <input
          type="checkbox"
          {...common}
          checked={props.value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.checked)}
          style={{ marginTop: css.xs }}
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
          style={baseStyle}
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
      <div
        data-testid={testId !== undefined ? `${testId}-empty` : "render-list-empty"}
        style={{ padding: css.lg, color: css.textMuted }}
      >
        {emptyState ?? <span>No entries.</span>}
      </div>
    );
  }
  const tableStyle: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: css.fontBody,
  };
  const thStyle: CSSProperties = {
    textAlign: "left",
    padding: `${css.sm} ${css.md}`,
    borderBottom: `1px solid ${css.border}`,
    fontSize: css.fontSmall,
    color: css.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  };
  const tdStyle: CSSProperties = {
    padding: `${css.sm} ${css.md}`,
    borderBottom: `1px solid ${css.border}`,
  };
  return (
    <table data-testid={testId} style={tableStyle}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.field}
              data-testid={`column-${col.field}`}
              data-sortable={col.sortable === true ? true : undefined}
              style={thStyle}
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
              <td key={col.field} data-testid={`cell-${row.id}-${col.field}`} style={tdStyle}>
                {renderCell(row.values[col.field], col.type, col.renderer)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
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

function DefaultForm({ onSubmit, children, testId }: FormProps): ReactNode {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(e);
      }}
      data-testid={testId}
      style={{ display: "flex", flexDirection: "column", gap: css.md }}
    >
      {children}
    </form>
  );
}

function DefaultSection({ title, children, testId }: SectionProps): ReactNode {
  const fieldsetStyle: CSSProperties = {
    border: `1px solid ${css.border}`,
    borderRadius: css.radiusMd,
    padding: css.md,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: css.md,
  };
  const legendStyle: CSSProperties = {
    padding: `0 ${css.xs}`,
    fontSize: css.fontSmall,
    color: css.textMuted,
  };
  return (
    <fieldset data-testid={testId} style={fieldsetStyle}>
      <legend style={legendStyle}>{title}</legend>
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
        gap: css.md,
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
      return (
        <code
          data-testid={testId}
          style={{
            background: css.surface,
            padding: `1px ${css.xs}`,
            borderRadius: css.radiusSm,
            fontSize: css.fontSmall,
            fontFamily: "'SF Mono', Menlo, Consolas, monospace",
          }}
        >
          {children}
        </code>
      );
    case "small":
      return (
        <small data-testid={testId} style={{ fontSize: css.fontSmall, color: css.textMuted }}>
          {children}
        </small>
      );
    case "required-mark":
      return (
        <span data-testid={testId} data-required style={{ color: css.dangerBg }}>
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
