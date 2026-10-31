import { Fragment, type ReactNode } from "react";
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
      {...(props.actionFormScreenQn !== undefined && {
        onSuggest: (value: string) => form.controller.seedField(field.field, value),
      })}
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
): ReactNode {
  const { Grid, GridCell } = model.engine.state.primitives;
  const { rowAfterField } = model.engine.props;
  const dirty = Object.keys(model.engine.form.snapshot.changes).length > 0;
  const { isSettingsList } = model.footer;
  const { usesFieldFlow } = model.titles;
  const renderCell = createFieldCellRenderer(model, section, columns);
  return (
    <Grid
      key={gridKey}
      columns={columns}
      {...(isSettingsList ? { list: true } : usesFieldFlow && { flow: true })}
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
