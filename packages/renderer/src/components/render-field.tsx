import type { EditFieldViewModel, FieldIssue } from "@kumiko/headless";
import { type ReactNode, useMemo } from "react";
import { useQuery } from "../hooks/use-query";
import { usePrimitives } from "../primitives";

// RenderField übersetzt ein EditFieldViewModel → Primitives-Baum.
// Kein raw HTML mehr; alle Darstellungsentscheidungen (Label-Position,
// Fehler-Layout, Input-Styling) leben in der Primitives-Implementation.
//
// Der field.type → Input-kind Mapping bleibt hier, weil es
// Domain-Logik ist (EntityDefinition-Feldtyp) und nicht Darstellung.

export type RenderFieldProps = {
  readonly field: EditFieldViewModel;
  readonly issues?: readonly FieldIssue[];
  readonly onChange: (value: unknown) => void;
  /** Nur bei type:"reference" relevant — Feature-Name für die Lookup-
   *  Query-QN (`<feature>:query:<refEntity>:list`). Andere Field-Types
   *  ignorieren das Prop. */
  readonly featureName?: string;
};

export function RenderField({ field, issues, onChange, featureName }: RenderFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  if (!field.visible) return null;

  const id = inputId(field);
  const hasError = issues !== undefined && issues.length > 0;

  // Reference-Field rendert eine eigene Component — sie nutzt
  // useQuery() für den Live-Lookup, also muss sie als React-
  // Komponente gemountet werden (nicht als pure render-Call).
  const control =
    field.type === "reference" ? (
      <ReferenceInput
        field={field}
        id={id}
        hasError={hasError}
        onChange={onChange}
        Input={Input}
        featureName={featureName ?? ""}
      />
    ) : (
      renderInput({ field, id, hasError, onChange, Input })
    );

  return (
    <Field
      id={id}
      label={field.label}
      required={field.required}
      {...(issues !== undefined && { issues })}
      testId={`field-${field.field}`}
    >
      {control}
    </Field>
  );
}

// Tier 2.7e-3: Reference-Input rendert ein Select-Dropdown gefüllt
// aus einer Live-Query auf die referenced Entity. MVP-Limits:
//   - limit: 50 — größere Datasets brauchen Tier 2.7e-5 / 2.1c
//     (Searchable Combobox).
//   - Display = row[refLabelField], Default labelField "id".
//   - Loading-State: leeres Dropdown bis die rows da sind. Field
//     ist disabled während useQuery läuft, damit der User nicht
//     ein leeres Dropdown öffnet und sich wundert.
//
// Storage: Der UI-Wert ist die UUID (row.id). Das Server-Schema
// erwartet z.uuid() (siehe schema-builder.ts).
function ReferenceInput({
  field,
  id,
  hasError,
  onChange,
  Input,
  featureName,
}: {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly hasError: boolean;
  readonly onChange: (value: unknown) => void;
  readonly Input: ReturnType<typeof usePrimitives>["Input"];
  readonly featureName: string;
}): ReactNode {
  const refEntity = field.refEntity ?? "";
  const labelField = field.refLabelField ?? "id";
  const queryQn = `${featureName}:query:${refEntity}:list`;
  const queryResult = useQuery<{ rows: ReadonlyArray<Record<string, unknown>> }>(queryQn, {
    limit: 50,
  });
  const options = useMemo(() => {
    const rows = queryResult.data?.rows ?? [];
    return rows.map((row) => {
      const id = String(row["id"] ?? "");
      const label = String(row[labelField] ?? id);
      return { value: id, label };
    });
  }, [queryResult.data, labelField]);
  const value = field.value === undefined || field.value === null ? "" : String(field.value);
  return (
    <Input
      kind="select"
      id={id}
      name={field.field}
      disabled={field.readOnly || queryResult.loading}
      required={field.required}
      hasError={hasError}
      value={value}
      onChange={(v) => onChange(v === "" ? null : v)}
      options={options}
    />
  );
}

function inputId(field: EditFieldViewModel): string {
  return `kumiko-edit-${field.field}`;
}

// Dispatch auf field.type → Input-Kind. Select threaded options aus dem
// EditFieldViewModel (computeEditViewModel zieht sie aus
// SelectFieldDef.options). Unknown-Types fallen auf text zurück damit
// die Form was Sinnvolles rendert statt blank zu sein.
function renderInput({
  field,
  id,
  hasError,
  onChange,
  Input,
}: {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly hasError: boolean;
  readonly onChange: (value: unknown) => void;
  readonly Input: ReturnType<typeof usePrimitives>["Input"];
}): ReactNode {
  const common = {
    id,
    name: field.field,
    disabled: field.readOnly,
    required: field.required,
    hasError,
  } as const;

  switch (field.type) {
    case "number":
      return (
        <Input
          kind="number"
          {...common}
          value={numberValue(field.value)}
          onChange={(v) => onChange(v)}
        />
      );
    case "money": {
      const moneyDef = field as unknown as { currency?: string; locale?: string };
      return (
        <Input
          kind="money"
          {...common}
          value={numberValue(field.value)}
          onChange={(v) => onChange(v)}
          {...(moneyDef.currency !== undefined && { currency: moneyDef.currency })}
          {...(moneyDef.locale !== undefined && { locale: moneyDef.locale })}
        />
      );
    }
    case "boolean":
      return (
        <Input
          kind="boolean"
          {...common}
          value={field.value === true}
          onChange={(v) => onChange(v)}
        />
      );
    case "date":
      return (
        <Input
          kind="date"
          {...common}
          value={stringValue(field.value)}
          onChange={(v) => onChange(v)}
        />
      );
    case "timestamp":
      return (
        <Input
          kind="timestamp"
          {...common}
          value={stringValue(field.value)}
          onChange={(v) => onChange(v)}
        />
      );
    case "select":
      return (
        <Input
          kind="select"
          {...common}
          value={stringValue(field.value)}
          onChange={(v) => onChange(v)}
          options={field.options ?? []}
        />
      );
    default: {
      // text + unknown → text input. Wenn TextFieldDef.multiline gesetzt
      // ist (das ViewModel hält's), wechselt der Renderer auf textarea.
      if (field.type === "text" && field.multiline) {
        const rows = typeof field.multiline === "object" ? field.multiline.rows : undefined;
        return (
          <Input
            kind="textarea"
            {...common}
            value={stringValue(field.value)}
            onChange={(v) => onChange(v)}
            {...(rows !== undefined && { rows })}
          />
        );
      }
      return (
        <Input
          kind="text"
          {...common}
          value={stringValue(field.value)}
          onChange={(v) => onChange(v)}
        />
      );
    }
  }
}

function stringValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : String(v);
}

function numberValue(v: unknown): number | "" {
  if (v === undefined || v === null || v === "") return "";
  return typeof v === "number" ? v : Number(v);
}
