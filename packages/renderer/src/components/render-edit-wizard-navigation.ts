import type { FormValues } from "../headless/index.ts";
import { tabIdAt, wizardStepKey } from "./render-edit-helpers.tsx";
import { findFirstErroringSectionIndex, resolveExtensionEntityId } from "./render-edit-logic.ts";
import type { RenderEditSteppedCore } from "./render-edit-render-model.ts";

export type WizardNavigation = {
  readonly persistExtensions: () => Promise<boolean>;
  readonly jumpToStep: (index: number) => void;
  readonly handleWizardNext: () => void;
  readonly handleWizardBack: () => void;
  readonly handleWizardStepSelect: (targetStep: number) => void;
  readonly findFirstErroringStep: (fieldPaths: readonly string[]) => number | undefined;
};

// Rebuilt every render on purpose: the closures read this render's step and
// section state, and the wizard refs publish the current ones.
export function createWizardNavigation<TValues extends FormValues, TCtx>(
  { props, state, form, draft, sections, steps }: RenderEditSteppedCore<TValues, TCtx>,
  saveDraft: (stepIndex: number) => void,
): WizardNavigation {
  const { disabled } = props;
  const { isCreateMode, isTabs, setRawStep } = state;
  const { filteredSections } = sections;
  const { currentStep, lastStepIndex } = steps;
  const { hasNavigatedRef } = draft.refs;

  // Persist all composed extension sections using the resolved entityId.
  // false means a section failed and its i18n key is shown in the banner. Without
  // entity context (create mode without a route id), there is nothing to write.
  async function persistExtensions(): Promise<boolean> {
    const entityId = resolveExtensionEntityId(props.entityId, sections.vm.id);
    if (entityId === null) return true;
    const results = await state.runExtensionSubmits({ entityId });
    const failed = results.find((r) => !r.isSuccess);
    if (failed !== undefined) {
      state.setExtensionErrorKey(failed.errorKey ?? "kumiko.form.extension.save-failed");
      return false;
    }
    return true;
  }

  function jumpToStep(index: number): void {
    setRawStep(index);
    if (isTabs) state.setActiveTabId(tabIdAt(filteredSections[index], index));
  }

  function currentStepHasFieldErrors(): boolean {
    const section = filteredSections[currentStep];
    const fieldNames = section?.kind === "fields" ? section.fields.map((f) => f.field) : [];
    return fieldNames.length > 0 && !form.controller.validate(fieldNames);
  }

  function markCurrentStepPassed(): void {
    const leftSection = filteredSections[currentStep];
    // skip: no current section to mark as passed
    if (leftSection === undefined) return;
    const leftKey = wizardStepKey(leftSection, currentStep);
    state.setPassedStepKeys((prev) => (prev.has(leftKey) ? prev : new Set(prev).add(leftKey)));
  }

  // Next: scoped validate() on the current step's fields — errors stay
  // attached to the field and block the step transition. Extension steps
  // have no field scope here (they validate via the controlled-mode
  // controls.validate() API), so no call, no clearing of unrelated errors.
  function handleWizardNext(): void {
    const next = Math.min(currentStep + 1, lastStepIndex);
    hasNavigatedRef.current = true;
    // Locked state: `disabled` means "no input/no write", not "no
    // navigation" — a disabled wizard must still be steppable so Back/Next
    // reach every step. But neither validate() (would block on an empty
    // required field nobody can fill in) nor saveDraft() (would mint a
    // draftId / dispatch a write — exactly what `disabled` forbids) may run.
    if (disabled) {
      setRawStep(next);
      // skip: locked wizard only steps, no validate or draft save
      return;
    }
    // skip: the current step has field errors — no transition, no draft save.
    if (currentStepHasFieldErrors()) return;
    if (!isCreateMode) markCurrentStepPassed();
    setRawStep(next);
    saveDraft(next);
  }

  function handleWizardBack(): void {
    handleWizardStepSelect(currentStep - 1);
  }

  // Update mode: the record already exists and the final Save validates the
  // whole form and jumps to the first erroring step (findFirstErroringStep), so
  // skipping steps forward is safe; leaving the current step still goes through
  // its validate gate.
  function handleWizardStepSelect(targetStep: number): void {
    // skip: already on the target step
    if (targetStep === currentStep) return;
    const isForward = targetStep > currentStep;
    // Create mode: a forward jump would skip the per-step validate() gate.
    // skip: create mode has no forward jump
    if (isForward && isCreateMode) return;
    // skip: current step has field errors
    if (isForward && !disabled && currentStepHasFieldErrors()) return;
    const clampedTarget = Math.min(Math.max(targetStep, 0), lastStepIndex);
    hasNavigatedRef.current = true;
    setRawStep(clampedTarget);
    if (!disabled) saveDraft(clampedTarget);
  }

  // Stepped modes (wizard, tabs): locates the first step whose "fields"
  // section contains one of the given field paths — matched on the path's
  // first segment, since `FieldIssue.path`/`snapshot.errors` keys can be
  // dotted (embedded-list rows, e.g. `tasks.2.title`) while a section's field
  // name is always the plain top-level name. Returns undefined for a
  // root-level issue (path `"(root)"`, see zod-bridge.ts) or one that matches
  // no rendered field — callers must NOT suppress the error banner in that
  // case, there is nowhere to jump the user to. Extension sections are not
  // jump targets by design: they validate through the controlled-mode
  // controls.validate() API and own no field specs to match against.
  function findFirstErroringStep(fieldPaths: readonly string[]): number | undefined {
    return findFirstErroringSectionIndex(filteredSections, fieldPaths);
  }

  return {
    persistExtensions,
    jumpToStep,
    handleWizardNext,
    handleWizardBack,
    handleWizardStepSelect,
    findFirstErroringStep,
  };
}
