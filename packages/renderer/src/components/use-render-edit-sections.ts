import { type Dispatch, type ReactNode, type SetStateAction, useMemo, useState } from "react";
import type { EditSectionViewModel, EditViewModel, FormValues } from "../headless/index.ts";
import { computeEditViewModel } from "../headless/index.ts";
import { filterEditSections, hasEditableSection } from "./render-edit-logic.ts";
import type { RenderEditCore } from "./render-edit-render-model.ts";

export type RenderEditSections = {
  readonly vm: EditViewModel;
  readonly filteredSections: readonly EditSectionViewModel[];
  readonly showsAllRequiredHint: boolean;
  readonly isFormEditable: boolean;
  readonly isFieldless: boolean;
  readonly fillHeight: boolean;
  readonly isLoneWriteFormTab: boolean;
  readonly writeFormFooterAction: ReactNode;
  readonly setWriteFormFooterAction: Dispatch<SetStateAction<ReactNode>>;
};

function useEditViewModel<TValues extends FormValues, TCtx>({
  props,
  state,
  form,
}: RenderEditCore<TValues, TCtx>): EditViewModel {
  const { screen, entity, featureName, formDerivation, actionFormScreenQn } = props;
  const entityIdProp = props.entityId;
  const { translate, isCreateMode } = state;
  const { writeVerb } = form;
  const values = form.snapshot.values;
  return useMemo(
    () =>
      computeEditViewModel({
        screen,
        entity,
        values,
        translate,
        featureName,
        mode: writeVerb,
        ...(!isCreateMode && entityIdProp != null && { entityId: entityIdProp }),
        ...(formDerivation !== undefined && { derivation: formDerivation }),
        ...(actionFormScreenQn !== undefined && { actionFormScreenQn }),
      }),
    [
      formDerivation,
      actionFormScreenQn,
      screen,
      entity,
      values,
      translate,
      featureName,
      writeVerb,
      isCreateMode,
      entityIdProp,
    ],
  );
}

function useFilteredSections(
  vm: EditViewModel,
  fieldsFilter: readonly string[] | undefined,
): readonly EditSectionViewModel[] {
  return useMemo(
    // A fully-hidden "fields" section (every field in it currently
    // condition-hidden) must not occupy a wizard step; it would render
    // empty and block Back/Next on nothing. Extension, relatedList and
    // writeForm sections carry no `visible` (they own their own lifecycle /
    // run their own query / own submit), so they always pass through. A
    // section with no fields at all (e.g. a review-only step) has
    // `visible: fields.some(...)` = false vacuously; that's "no fields to
    // hide", not "hidden", so it stays too. Unless the create
    // exclusion emptied it: that would leave an empty wizard step / tab.
    () =>
      filterEditSections(vm.sections, fieldsFilter).filter(
        (section) =>
          section.kind === "extension" ||
          section.kind === "relatedList" ||
          section.kind === "writeForm" ||
          (section.fields.length === 0 && section.emptiedByWriteExclusion !== true) ||
          section.visible,
      ),
    [vm.sections, fieldsFilter],
  );
}

function useAllFieldsRequired(filteredSections: readonly EditSectionViewModel[]): boolean {
  return useMemo(() => {
    const fillable = filteredSections.flatMap((section) =>
      section.kind === "fields"
        ? section.fields.filter(
            (field) => field.visible && !field.readOnly && field.type !== "boolean",
          )
        : [],
    );
    return fillable.length > 0 && fillable.every((field) => field.required);
  }, [filteredSections]);
}

export function useRenderEditSections<TValues extends FormValues, TCtx>(
  core: RenderEditCore<TValues, TCtx>,
): RenderEditSections {
  const { props, state } = core;
  const { hideSectionTitles, fillScreenHeight } = props;
  const vm = useEditViewModel(core);
  const filteredSections = useFilteredSections(vm, props.fields);
  const allFieldsRequired = useAllFieldsRequired(filteredSections);

  const showsAllRequiredHint = allFieldsRequired && hideSectionTitles !== true && !state.isWizard;

  // true when editable fields exist or an extension opted into composed submit.
  const isFormEditable = hasEditableSection(filteredSections);
  // A fieldless form (input-less secretMint mint — the secret is
  // server-generated, the mint step is only its submit button) has no
  // section to gate on: it IS the action, so it always shows the submit
  // button, and it can never go dirty either.
  const isFieldless = Object.keys(props.entity.fields).length === 0;

  // A lone relatedList tab (`hideSectionTitles` is only ever set by
  // ProjectionDetailBody, which hands this component ONE section — its
  // synthesized screen drops layout.mode, so an entityEdit tabs layout never
  // reaches this line and `filteredSections[0]` stays the active section)
  // needs its own tab panel capped at the available height so its table
  // scrolls inside the panel instead of the whole page stretching to the
  // row count — a short table still sizes to its content instead
  // of stretching the panel to the bottom. Any other layout —
  // multiple sections, a non-relatedList tab, stacked (non-tabs) forms —
  // keeps normal document-flow height untouched.
  const fillHeight =
    fillScreenHeight === true ||
    (hideSectionTitles === true && filteredSections[0]?.kind === "relatedList");

  // A lone writeForm tab is the whole page, so its submit joins this form's
  // footer (pinned to the window edge like every other screen's save)
  // instead of sitting in the section's title row.
  const isLoneWriteFormTab =
    hideSectionTitles === true && filteredSections[0]?.kind === "writeForm";
  const [writeFormFooterAction, setWriteFormFooterAction] = useState<ReactNode>(undefined);
  return {
    vm,
    filteredSections,
    showsAllRequiredHint,
    isFormEditable,
    isFieldless,
    fillHeight,
    isLoneWriteFormTab,
    writeFormFooterAction,
    setWriteFormFooterAction,
  };
}
