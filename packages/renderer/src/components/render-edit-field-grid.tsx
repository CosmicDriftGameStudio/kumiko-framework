import { type ComponentType, Fragment, type ReactNode } from "react";
import type { EditFieldViewModel, FormValues } from "../headless/index.ts";
import type { StatusBadgeProps } from "../primitives.tsx";
import { statusToneForOptionTone } from "../status-tone.ts";
import { fieldCellWidth, GridCellForField } from "./grid-cell-for-field.tsx";
import type {
  FieldsSection,
  RenderEditModel,
  ResolvedRenderEditProps,
} from "./render-edit-render-model.ts";

type AppendixProps = Pick<
  ResolvedRenderEditProps<FormValues>,
  "labelAppendix" | "fieldAppendix" | "fieldAppendixPlacement" | "fieldDescription"
>;

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function declaredBadge(
  field: EditFieldViewModel,
  values: Readonly<Record<string, unknown>>,
  StatusBadge: ComponentType<StatusBadgeProps> | undefined,
): ReactNode {
  if (field.badge === undefined || StatusBadge === undefined) return undefined;
  const text = "label" in field.badge ? field.badge.label : nonEmptyText(values[field.badge.field]);
  if (text === undefined) return undefined;
  return (
    <StatusBadge
      value={text}
      tone={statusToneForOptionTone(field.badge.tone) ?? "muted"}
      testId={`field-badge-${field.field}`}
    />
  );
}

export function appendixCellProps(
  props: AppendixProps,
  field: EditFieldViewModel,
  values: Readonly<Record<string, unknown>>,
  StatusBadge: ComponentType<StatusBadgeProps> | undefined,
) {
  const { labelAppendix, fieldAppendix, fieldAppendixPlacement, fieldDescription } = props;
  const fieldName = field.field;
  const badge = declaredBadge(field, values, StatusBadge);
  const hint = field.hintField !== undefined ? nonEmptyText(values[field.hintField]) : undefined;
  const declaredDescription = fieldDescription?.(fieldName, values);
  return {
    ...(labelAppendix !== undefined && { labelAppendix: labelAppendix(fieldName) }),
    ...(labelAppendix === undefined && badge !== undefined && { labelAppendix: badge }),
    ...(fieldAppendix !== undefined && { fieldAppendix: fieldAppendix(fieldName) }),
    ...(fieldAppendixPlacement !== undefined && { appendixPlacement: fieldAppendixPlacement }),
    ...((declaredDescription ?? hint) !== undefined && {
      description: declaredDescription ?? hint,
    }),
  };
}

// Multi-line and wide kinds (textarea, lists, files) take the whole row of a facts grid; a plain
// read-only text would also count as full width, so the width is asked as if the field were editable.
function spanLongValue(field: EditFieldViewModel, columns: number): EditFieldViewModel {
  if (field.span !== undefined || fieldCellWidth({ ...field, readOnly: false }) !== "full") {
    return field;
  }
  return { ...field, span: columns };
}

function createFieldCellRenderer<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  section: FieldsSection,
  columns: number,
  flows: boolean,
  facts: boolean,
): (field: EditFieldViewModel) => ReactNode {
  const { props, state, form } = model.engine;
  const { snapshot } = form;
  const { GridCell } = state.primitives;
  const { isSettingsList, isCreate } = model.footer;
  const { disabled, fieldAccent } = props;
  const showsChangedMarker = !isCreate || props.markChangedFields;
  const clearErrorsAndValidate = (fieldName: string): void => {
    form.clearErrorsOnInput(fieldName);
    if (props.validateOnChange === true) form.controller.validate([fieldName]);
  };
  return (rawField) => {
    const field = facts ? spanLongValue(rawField, columns) : rawField;
    return (
      <GridCellForField
        key={field.field}
        field={disabled ? { ...field, readOnly: true } : field}
        columns={columns}
        {...(!isSettingsList && flows && { flow: true })}
        {...(isSettingsList && {
          layout: "row" as const,
          accent: fieldAccent?.(field.field) === true,
        })}
        issues={snapshot.errors[field.field]}
        onChange={(v) => {
          model.setFieldUntyped(field.field, v);
          clearErrorsAndValidate(field.field);
        }}
        {...(props.actionFormScreenQn !== undefined && {
          onSuggest: (value: string) => form.controller.seedField(field.field, value),
        })}
        GridCell={GridCell}
        featureName={props.featureName}
        {...appendixCellProps(props, field, snapshot.values, state.primitives.StatusBadge)}
        allIssues={snapshot.errors}
        valueDisplay={props.valueDisplay}
        row={snapshot.values}
        {...(disabled && { fillDisabled: true })}
        {...(props.hideSectionTitles !== true &&
          section.title !== undefined && { sectionTitle: section.title })}
        {...(showsChangedMarker && field.field in snapshot.changes && { changed: true })}
      />
    );
  };
}

// The flow layout sizes each field by its type and ignores `columns`; a section that declares
// several columns asks for equal grid cells, so every field fills its cell instead.
function usesFlowLayout<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  facts: boolean,
  columns: number,
  columnsDeclared: boolean,
): boolean {
  return model.titles.usesFieldFlow && !facts && !(columnsDeclared && columns > 1);
}

// Read-only text values with a declared column count form a label/value grid; the flow layout
// would ignore `columns` and give every value the full width. Without a declared count the
// stacked layout stays, so existing records do not reflow.
function isReadOnlyFactsGrid<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  fields: readonly EditFieldViewModel[],
  columns: number,
  columnsDeclared: boolean,
): boolean {
  return (
    columnsDeclared &&
    columns > 1 &&
    !model.footer.isSettingsList &&
    model.engine.props.valueDisplay === "text" &&
    fields.length > 0 &&
    fields.every((field) => field.readOnly)
  );
}

export function renderFieldGrid<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  section: FieldsSection,
  fields: readonly EditFieldViewModel[],
  columns: number,
  gridKey: string,
  columnsDeclared = false,
): ReactNode {
  const { Grid, GridCell } = model.engine.state.primitives;
  const { rowAfterField } = model.engine.props;
  const dirty = Object.keys(model.engine.form.snapshot.changes).length > 0;
  const { isSettingsList } = model.footer;
  const facts = isReadOnlyFactsGrid(model, fields, columns, columnsDeclared);
  const flows = usesFlowLayout(model, facts, columns, columnsDeclared);
  const renderCell = createFieldCellRenderer(model, section, columns, flows, facts);
  return (
    <Grid
      key={gridKey}
      columns={columns}
      {...(facts && { facts: true })}
      {...(isSettingsList ? { list: true } : flows && { flow: true })}
    >
      {fields.map((field: EditFieldViewModel) => {
        const extraRow = rowAfterField?.(field.field, { dirty });
        if (extraRow === undefined) return renderCell(field);
        return (
          <Fragment key={field.field}>
            {renderCell(field)}
            <GridCell span={columns}>{extraRow}</GridCell>
          </Fragment>
        );
      })}
    </Grid>
  );
}
