import type { DispatcherError, FormValues, SubmitResult } from "../headless/index.ts";
import { groupIssuesByPath } from "../headless/index.ts";
import { hasIssueWithoutRenderedField } from "./render-edit-logic.ts";
import type { RenderEditEngineBase } from "./render-edit-render-model.ts";

export function createSubmitResultHandlers<TValues extends FormValues, TCtx>({
  props,
  state,
  form,
  draft,
  sections,
  draftActions,
  nav,
}: RenderEditEngineBase<TValues, TCtx>) {
  const { controller } = form;
  const { customSubmit } = props;
  const { submittedRef } = draft.refs;

  // `isNoOp: true` (payloadMode "changes", pre-filled form submitted
  // untouched) means controller.submit() never called dispatcher.write
  // — nothing to discard, and discarding here would delete a draft the
  // form never persisted. Awaited, not fire-and-forget:
  // `onSubmit` typically navigates away and unmounts this form, which
  // would abort an in-flight discard and leave the draft behind after
  // a successful submit.
  // Resolves to whether the extension sections persisted (true when none ran).
  async function handleSubmitSuccess(isNoOp: boolean): Promise<boolean> {
    state.setFormError(null);
    state.setExtraDeleteIssues([]);
    if (!isNoOp) {
      submittedRef.current = true;
      await draftActions.discardDraft();
    }
    const extensionsPersisted = await nav.persistExtensions();
    if (extensionsPersisted) state.extensionDirtyRef.current = false;
    return extensionsPersisted;
  }

  function jumpToFirstErroringStep(fieldPaths: readonly string[]): void {
    // skip: unstepped layouts have no step to jump to
    if (!state.isStepped) return;
    const step = nav.findFirstErroringStep(fieldPaths);
    if (step !== undefined) nav.jumpToStep(step);
  }

  // Root-level `.refine()`/cross-field issues from controller.validate()
  // — same "jump to the erroring step" treatment as a server field
  // error below, sourced from the freshly-validated snapshot.
  function handleValidationBlocked(): void {
    state.setFocusFirstErrorKey((key) => key + 1);
    jumpToFirstErroringStep(Object.keys(controller.getSnapshot().errors));
  }

  function handleSubmitError(error: DispatcherError): void {
    const fieldIssues = error.details?.fields ?? [];
    const issuePaths = fieldIssues.map((i) => i.path);
    if (fieldIssues.length > 0) state.setFocusFirstErrorKey((key) => key + 1);
    // controller.submit() writes server issues into the controller itself;
    // customSubmit bypasses it, so push them here to reach the fields.
    if (customSubmit !== undefined && fieldIssues.length > 0) {
      controller.setErrors(groupIssuesByPath(fieldIssues));
    }
    // A server field error on a step the form isn't currently showing is
    // otherwise invisible — jump to the first step that contains one of
    // the errored fields. For tabs this is what keeps the submit from
    // blocking in silence, the failure mode the boot-validator used to
    // prevent by rejecting the layout outright. An issue no
    // rendered field can show (`version`, `id`, a root-level refine, a
    // hidden field) keeps the banner, jump or not.
    jumpToFirstErroringStep(issuePaths);
    state.setExtraDeleteIssues([]);
    state.setFormErrorSource("submit");
    state.setFormError(
      hasIssueWithoutRenderedField(
        issuePaths,
        sections.filteredSections,
        new Set(Object.keys(props.formDerivation?.derive ?? {})),
      )
        ? error
        : null,
    );
  }

  // Form-level errors (without field-level details) go to the banner.
  // Field errors flow via snapshot.errors into the individual fields.
  // Synchronous on purpose: awaiting here would defer the state updates by a
  // microtask and let React render intermediate states.
  function applySubmitFailure(result: Exclude<SubmitResult<unknown>, { isSuccess: true }>): void {
    if (result.validationBlocked) handleValidationBlocked();
    else handleSubmitError(result.error);
  }

  return { handleSubmitSuccess, applySubmitFailure };
}
