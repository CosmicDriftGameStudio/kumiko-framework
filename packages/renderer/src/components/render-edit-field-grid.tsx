import type { ReactNode } from "react";
import type { EditFieldViewModel, FormValues } from "../headless/index.ts";
import { GridCellForField } from "./grid-cell-for-field.tsx";
import type {
  FieldsSection,
  RenderEditModel,
  ResolvedRenderEditProps,
} from "./render-edit-render-model.ts";

type AppendixProps = Pick<
  ResolvedRenderEditProps<FormValues>,
  "labelAppendix" | "fieldAppendix" | "fieldAppendixPlacement" | "fieldDescription"
>;

function appendixCellProps(props: AppendixProps, fieldName: string) {
  const { labelAppendix, fieldAppendix, fieldAppendixPlacement, fieldDescription } = props;
  return {
    ...(labelAppendix !== undefined && { labelAppendix: labelAppendix(fieldName) }),
    ...(fieldAppendix !== undefined && { fieldAppendix: fieldAppendix(fieldName) }),
    ...(fieldAppendixPlacement !== undefined && { appendixPlacement: fieldAppendixPlacement }),
    ...(fieldDescription !== undefined && { description: fieldDescription(fieldName) }),
  };
}

function createFieldCellRenderer<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  section: FieldsSection,
  columns: number,
): (field: EditFieldViewModel) => ReactNode {
  const { props, state, form } = model.engine;
  const { snapshot } = form;
  const { GridCell } = state.primitives;
  const { isSettingsList, isCreate } = model.footer;
  const { usesFieldFlow } = model.titles;
  const { disabled, fieldAccent } = props;
  const showsChangedMarker = !isCreate || props.markChangedFields;
  const clearErrorsAndValidate = (fieldName: string): void => {
    form.clearErrorsOnInput(fieldName);
    if (props.validateOnChange === true) form.controller.validate([fieldName]);
  };
  return (field) => (
    <GridCellForField
      key={field.field}
      field={disabled ? { ...field, readOnly: true } : field}
      columns={columns}
      {...(!isSettingsList && usesFieldFlow && { flow: true })}
      {...(isSettingsList && {
        layout: "row" as const,
        accent: fieldAccent?.(field.field) === true,
      })}
      issues={snapshot.errors[field.field]}
      onChange={(v) => {
        model.setFieldUntyped(field.field, v);
        clearErrorsAndValidate(field.field);
      }}
      GridCell={GridCell}
      featureName={props.featureName}
      {...appendixCellProps(props, field.field)}
      allIssues={snapshot.errors}
      valueDisplay={props.valueDisplay}
      row={snapshot.values}
      {...(disabled && { fillDisabled: true })}
      {...(props.hideSectionTitles !== true &&
        section.title !== undefined && { sectionTitle: section.title })}
      {...(showsChangedMarker && field.field in snapshot.changes && { changed: true })}
    />
  );
}

export function renderFieldGrid<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  section: FieldsSection,
  fields: readonly EditFieldViewModel[],
  columns: number,
  gridKey: string,
  columnsDeclared: boolean | undefined,
): ReactNode {
  const { Grid } = model.engine.state.primitives;
  const { isSettingsList } = model.footer;
  const { usesFieldFlow } = model.titles;
  const renderCell = createFieldCellRenderer(model, section, columns);
  return (
    <Grid
      key={gridKey}
      columns={usesFieldFlow && columnsDeclared !== true ? 1 : columns}
      {...(isSettingsList ? { list: true } : usesFieldFlow && { flow: true })}
    >
      {fields.map((field: EditFieldViewModel) => renderCell(field))}
    </Grid>
  );
}
