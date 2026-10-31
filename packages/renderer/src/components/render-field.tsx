import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { EditFieldViewModel, FieldIssue } from "../headless/index.ts";
import { useLocale, useTranslation } from "../i18n.tsx";
import { type FieldProps, usePrimitives } from "../primitives.tsx";
import { listPrintsOwnIssues, renderControl } from "./render-field-control.tsx";
import { inputId } from "./render-field-meta.ts";

// RenderField translates an EditFieldViewModel into a primitives tree.
// Raw HTML is excluded; all presentation decisions (label position,
// error layout, input styling) belong to the primitives implementation.
//
// The field.type → input-kind mapping (render-field-input.tsx) is
// domain logic (EntityDefinition field type), not presentation.

// `hideLabel` is not part of EditFieldViewModel/EntityEditScreenDefinition (no
// schema slot); the section renderer sets it for an embedded list whose label
// repeats the section title.
export type RenderFieldProps = {
  readonly field: EditFieldViewModel;
  readonly issues?: readonly FieldIssue[];
  readonly onChange: (val: unknown) => void;
  /** Seeds an empty optionsQuery select with the query's default row as a baseline
   *  value (not a change). Only set where that is wanted (actionForm). */
  readonly onSuggest?: (value: string) => void;
  /** Relevant only for type:"reference": the feature name for the lookup
   *  query QN (`<feature>:query:<refEntity>:list`). Other field types
   *  ignore this prop. */
  readonly featureName?: string;
  /** Optional content rendered after the label (for example,
   *  ConfigSourceBadge). */
  readonly labelAppendix?: ReactNode;
  /** Optional content rendered after the input (for example,
   *  ConfigCascade). */
  readonly fieldAppendix?: ReactNode;
  readonly appendixPlacement?: FieldProps["appendixPlacement"];
  readonly description?: ReactNode;
  readonly status?: FieldProps["status"];
  /** Flat issues-by-path map (FormSnapshot.errors) — only relevant for
   *  type:"embedded" with embeddedListCells, to bucket row-/cell-issues
   *  (`${field}.${rowIndex}` / `${field}.${rowIndex}.${cellField}`).
   *  Other field types ignore this prop. */
  readonly allIssues?: Readonly<Record<string, readonly FieldIssue[]>>;
  /** "form" (default) renders every field as its editable Input, disabled
   *  when `field.readOnly` — unchanged behavior. "text" renders a
   *  `field.readOnly` field as plain text instead (projectionDetail's read
   *  view); editable fields are untouched by this prop either way. */
  readonly valueDisplay?: "form" | "text";
  /** Current form values, keyed by field name. Consulted when
   *  `field.renderer` resolves to a `{ react: { __component } }` registry
   *  component (passed through as `ColumnRendererProps.row`, same contract
   *  as list-column renderers), and to resolve a `type: "number"`
   *  field's sibling-field `unit`. Omitted → falls back to a single-key
   *  `{ [field.field]: field.value }` row. */
  readonly row?: Readonly<Record<string, unknown>>;
  /** Marks the field as modified against the loaded record (edit mode only). */
  readonly changed?: boolean;
  readonly layout?: FieldProps["layout"];
  readonly accent?: boolean;
  /** The surrounding form is locked as a whole: the fill button stays visible
   *  but inert, unlike a single readOnly field whose fill button keeps working. */
  readonly fillDisabled?: boolean;
  /** Label stays for screen readers only (sr-only). */
  readonly hideLabel?: boolean;
};

const AllFieldsRequiredContext = createContext(false);

export const AllFieldsRequiredProvider = AllFieldsRequiredContext.Provider;

type FieldOptionalPropsInput = Pick<
  RenderFieldProps,
  | "issues"
  | "labelAppendix"
  | "fieldAppendix"
  | "appendixPlacement"
  | "description"
  | "status"
  | "changed"
  | "layout"
  | "accent"
  | "hideLabel"
> & { readonly printsIssues: boolean };

type FieldOptionalProps = Partial<
  Pick<
    FieldProps,
    | "issues"
    | "labelAppendix"
    | "fieldAppendix"
    | "appendixPlacement"
    | "description"
    | "status"
    | "changed"
    | "layout"
    | "accent"
    | "hideLabel"
  >
>;

function fieldOptionalProps({
  issues,
  printsIssues,
  labelAppendix,
  fieldAppendix,
  appendixPlacement,
  description,
  status,
  changed,
  layout,
  accent,
  hideLabel,
}: FieldOptionalPropsInput): FieldOptionalProps {
  return {
    ...(issues !== undefined && printsIssues && { issues }),
    ...(labelAppendix !== undefined && { labelAppendix }),
    ...(fieldAppendix !== undefined && { fieldAppendix }),
    ...(appendixPlacement !== undefined && { appendixPlacement }),
    ...(description !== undefined && { description }),
    ...(status !== undefined && { status }),
    ...(changed === true && { changed }),
    ...(layout !== undefined && { layout }),
    ...(accent === true && { accent }),
    ...(hideLabel === true && { hideLabel }),
  };
}

export function RenderField({
  field,
  issues,
  onChange,
  onSuggest,
  featureName,
  labelAppendix,
  fieldAppendix,
  appendixPlacement,
  description,
  status,
  allIssues,
  valueDisplay = "form",
  row,
  changed,
  layout,
  accent,
  fillDisabled,
  hideLabel,
}: RenderFieldProps): ReactNode {
  const { Field, Input, Banner, Text, JsonView, Link } = usePrimitives();
  // The app locale is required for money/date inputs; otherwise they fall back
  // to navigator.language instead of the selected app language. RenderField is
  // publicly exported and therefore requires a LocaleProvider; standalone
  // consumers and tests must wrap it (createKumikoApp does this).
  const appLocale = useLocale().locale();
  const t = useTranslation();
  const allFieldsRequired = useContext(AllFieldsRequiredContext);
  if (!field.visible) return null;

  const id = inputId(field);
  // An author-declared renderer always wins over the input widget, same as
  // the list-column path (render-list.tsx). Only takes effect once the field
  // is actually readOnly — a FormatSpec/PlatformComponent renderer has no
  // editable widget of its own, so applying it to an editable field would
  // silently make that field un-editable.
  const readOnlyText = valueDisplay === "text" && field.readOnly && field.renderer === undefined;
  const control = renderControl({
    field,
    id,
    hasError: issues !== undefined && issues.length > 0,
    onChange,
    ...(onSuggest !== undefined && { onSuggest }),
    Input,
    appLocale,
    Banner,
    Text,
    Link,
    JsonView,
    t,
    readOnlyText,
    featureName,
    allIssues,
    changed,
    fillDisabled,
    ...(row !== undefined && { row }),
  });

  return (
    <Field
      id={id}
      label={field.label}
      required={field.required && field.type !== "boolean" && !allFieldsRequired}
      {...fieldOptionalProps({
        issues,
        printsIssues: !listPrintsOwnIssues(field),
        labelAppendix,
        fieldAppendix,
        appendixPlacement,
        description,
        status,
        changed,
        layout,
        accent,
        hideLabel,
      })}
      testId={`field-${field.field}`}
    >
      {control}
    </Field>
  );
}
