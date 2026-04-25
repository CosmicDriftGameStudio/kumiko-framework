import type { EditFieldViewModel, FieldIssue } from "@kumiko/headless";
import type { ReactNode } from "react";
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
};

export function RenderField({ field, issues, onChange }: RenderFieldProps): ReactNode {
  const { Field, Input } = usePrimitives();
  if (!field.visible) return null;

  const id = inputId(field);
  const hasError = issues !== undefined && issues.length > 0;

  const control = renderInput({ field, id, hasError, onChange, Input });

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
    case "money":
      return (
        <Input
          kind="number"
          {...common}
          value={numberValue(field.value)}
          onChange={(v) => onChange(v)}
        />
      );
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
    case "timestamp":
      return (
        <Input
          kind="date"
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
    default:
      // text, unknown → plain text input
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

function stringValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : String(v);
}

function numberValue(v: unknown): number | "" {
  if (v === undefined || v === null || v === "") return "";
  return typeof v === "number" ? v : Number(v);
}
