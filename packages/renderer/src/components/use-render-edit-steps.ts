import { useMemo } from "react";
import type { EditSectionViewModel, FormValues } from "../headless/index.ts";
import { dryRunParse, isFieldsStepFilled, tabIdAt, wizardStepKey } from "./render-edit-helpers.tsx";
import type { RenderEditSectioned } from "./render-edit-render-model.ts";

export type RenderEditSteps = {
  readonly lastStepIndex: number;
  readonly currentStep: number;
  readonly isLastWizardStep: boolean;
  readonly wizardDoneSteps: readonly boolean[] | undefined;
  readonly updateModeStepBarProps:
    | Record<string, never>
    | { readonly doneSteps: readonly boolean[]; readonly selectableSteps: "all" };
};

function computeCurrentStep(
  isTabs: boolean,
  activeTabId: string | undefined,
  rawStep: number,
  filteredSections: readonly EditSectionViewModel[],
): { readonly currentStep: number; readonly lastStepIndex: number } {
  const lastStepIndex = Math.max(filteredSections.length - 1, 0);
  // Clamped on read, not on write: section visibility is value-dependent, so a
  // stored stepIndex can point past what is currently rendered — that lands on
  // the last step instead of an empty one.
  const activeTabIndex =
    isTabs && activeTabId !== undefined
      ? filteredSections.findIndex((s, i) => tabIdAt(s, i) === activeTabId)
      : -1;
  const currentStep = activeTabIndex !== -1 ? activeTabIndex : Math.min(rawStep, lastStepIndex);
  return { currentStep, lastStepIndex };
}

function isStepDone(
  section: EditSectionViewModel,
  index: number,
  passedStepKeys: ReadonlySet<string>,
  extensionStepComplete: Readonly<Record<string, boolean>>,
  parse: ReturnType<typeof dryRunParse>,
): boolean {
  if (passedStepKeys.has(wizardStepKey(section, index))) return true;
  if (section.kind === "fields") return isFieldsStepFilled(section, parse);
  return (
    section.kind === "extension" && extensionStepComplete[wizardStepKey(section, index)] === true
  );
}

export function useRenderEditSteps<TValues extends FormValues, TCtx>({
  props,
  state,
  form,
  draft,
  sections,
}: RenderEditSectioned<TValues, TCtx>): RenderEditSteps {
  const { filteredSections } = sections;
  const { schema } = props;
  const { isWizard, isCreateMode, passedStepKeys, extensionStepComplete } = state;
  const { currentStep, lastStepIndex } = computeCurrentStep(
    state.isTabs,
    state.activeTabId,
    state.rawStep,
    filteredSections,
  );
  // Kept fresh for patchAndScheduleDraftSave's debounce timer above, which
  // is defined before `currentStep` exists (it depends on `filteredSections`,
  // computed further up from `vm`) and so cannot close over it directly.
  draft.refs.currentStepRef.current = currentStep;
  const isLastWizardStep = currentStep >= lastStepIndex;

  const wizardDoneSteps = useMemo(() => {
    if (!isWizard || isCreateMode) return undefined;
    const parse =
      schema === undefined
        ? undefined
        : dryRunParse(schema, { values: form.snapshot.values, fields: form.snapshot.fields });
    return filteredSections.map((section, index) =>
      isStepDone(section, index, passedStepKeys, extensionStepComplete, parse),
    );
  }, [
    isWizard,
    isCreateMode,
    filteredSections,
    passedStepKeys,
    extensionStepComplete,
    schema,
    form.snapshot.values,
    form.snapshot.fields,
  ]);
  const updateModeStepBarProps: RenderEditSteps["updateModeStepBarProps"] =
    wizardDoneSteps === undefined
      ? {}
      : { doneSteps: wizardDoneSteps, selectableSteps: "all" as const };
  return { lastStepIndex, currentStep, isLastWizardStep, wizardDoneSteps, updateModeStepBarProps };
}
