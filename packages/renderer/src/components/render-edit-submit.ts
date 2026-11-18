import { type FormValues, type SubmitResult, snapshotWithPayloadPatch } from "../headless/index.ts";
import {
  createdEntityIdOf,
  isSubmitBlockedByLayoutCondition,
  shouldNotifyCaller,
} from "./render-edit-logic.ts";
import type { RenderEditEngineBase } from "./render-edit-render-model.ts";
import { createSubmitResultHandlers } from "./render-edit-submit-result.ts";

export type RenderEditSubmitOptions<TValues extends FormValues> = {
  readonly saveNow?: boolean;
  readonly payloadPatch?: Partial<TValues>;
};

// Rebuilt every render on purpose: the closures read this render's props and
// step state, while handleSubmitRef publishes the current one.
export function createHandleSubmit<TValues extends FormValues, TCtx>(
  engine: RenderEditEngineBase<TValues, TCtx>,
): (options?: RenderEditSubmitOptions<TValues>) => Promise<void> {
  const { props, state, form, draft, steps, draftActions, nav } = engine;
  const { handleSubmitSuccess, applySubmitFailure } = createSubmitResultHandlers(engine);
  const { controller } = form;
  const { customSubmit } = props;
  const { submittedRef, isSubmittingRef } = draft.refs;

  // Same discard as the main path: an extension-only save is still a
  // successful submit, so the draft must not survive it.
  async function submitExtensionsOnly(): Promise<void> {
    // skip: an extension section failed, its error banner is showing
    if (!(await nav.persistExtensions())) return;
    state.extensionDirtyRef.current = false;
    submittedRef.current = true;
    await draftActions.discardDraft();
  }

  // customSubmit path (e.g. configEdit, which performs a separate write per
  // field). Validate on the client first, then call the caller; on success,
  // explicitly rebase the form state because controller.submit() normally
  // does this itself, and the controller otherwise knows nothing about a
  // successful custom submission (isUnchanged would remain false).
  //
  // Read the snapshot directly from the controller rather than React state.
  // With rapid fill-then-click input, React batching may not have committed
  // state updates when the submit click fires. handleSubmit's closure could otherwise
  // see stale snapshot.changes={} and perform no writes, then return success
  // and rebase the form, making it appear that the data was saved.
  // controller.getSnapshot() is always current: the controller is the
  // source of truth, while React state is only a rendering mirror.
  function blockedCustomSubmitResult(): SubmitResult<unknown> | undefined {
    if (controller.validate(form.scopeFieldNames)) return undefined;
    // Field order matters: validationBlocked:true is its own
    // variant in the SubmitResult union (NOT mixed with data/error);
    // TS only narrows cleanly without a discriminator fight.
    const blocked: SubmitResult<unknown> = {
      validationBlocked: true,
      isSuccess: false,
    };
    return blocked;
  }

  // A typed secret was just written; keeping the plaintext in form state would
  // leave it readable in memory and re-sendable. Back to the write-only wire
  // shape "set" (true), so the field shows the masked row again.
  function dropSavedSecrets(): void {
    const values = controller.getSnapshot().values;
    const saved: Record<string, true> = {};
    for (const [name, def] of Object.entries(props.entity.fields)) {
      if ("writeOnly" in def && def.writeOnly === true && typeof values[name] === "string") {
        if (values[name] !== "") saved[name] = true;
      }
    }
    if (Object.keys(saved).length > 0) controller.setValues({ ...values, ...saved });
  }

  // Enter in the active step triggers the native form submit (Next is
  // type="submit" for Enter support) — on intermediate steps that means
  // "Next", not "Save". Checked BEFORE the `disabled` guard below:
  // `disabled` means "no input/no write", not "no navigation" — a
  // disabled wizard must still be steppable (handleWizardNext itself
  // blocks validate()/saveDraft() while disabled). `saveNow` is the explicit
  // "Save and close" button and skips the step advance.
  function advancesWizardInsteadOfSaving(
    options: RenderEditSubmitOptions<TValues> | undefined,
  ): boolean {
    return state.isWizard && !steps.isLastWizardStep && options?.saveNow !== true;
  }

  // Locked state: the submit button is visibly disabled, but a
  // native form submit (Enter key) reaches this handler regardless of the
  // button's disabled attribute — block it here too, not just in the UI.
  // Sync guard for the in-flight part — React state `isSubmitting` is too late
  // for double-clicks in the same tick (customSubmit has no submitInFlight of its own).
  function isSubmitBlocked(): boolean {
    return (
      props.disabled === true ||
      props.submitBlocked === true ||
      isSubmitBlockedByLayoutCondition(props.screen.layout, controller.getSnapshot().values) ||
      isSubmittingRef.current ||
      state.pendingUploadsRef.current > 0
    );
  }

  // The saved patch joins the form, or a later "values" Save would send the old value and undo
  // the footer action.
  function adoptCustomSubmitted(payloadPatch: Partial<TValues> | undefined): void {
    dropSavedSecrets();
    if (payloadPatch !== undefined) controller.setValues(payloadPatch);
    controller.rebase();
  }

  // A gated field's start value (a default, false, a prefill) would make the server refuse the
  // create, and the read-only field gives the user no way to clear it.
  function untouchedGatedFieldsOnCreate(): readonly string[] {
    if (!state.isCreateMode) return [];
    const { changes } = controller.getSnapshot();
    return state.fieldApproval.gatedFields.filter((fieldName) => !(fieldName in changes));
  }

  // Awaits only where the original did: a validation-blocked customSubmit
  // must settle in the same tick so setIsSubmitting(true/false) batch.
  return async function handleSubmit(options?: RenderEditSubmitOptions<TValues>): Promise<void> {
    if (advancesWizardInsteadOfSaving(options)) {
      nav.handleWizardNext();
      // skip: handled as a wizard step advance
      return;
    }
    // skip: locked, blocked or a submit is already in flight
    if (isSubmitBlocked()) return;
    isSubmittingRef.current = true;
    state.setIsSubmitting(true);
    state.setExtensionErrorKey(null);
    try {
      // Extension-only: only a section is dirty and the main form is unchanged.
      // Skip the entity write (it would send an empty changes payload) and only
      // run the section handlers. Read live state: a caller in the same tick
      // may have just reset the main form after this render's snapshot.
      const payloadPatch = options?.payloadPatch;
      if (
        payloadPatch === undefined &&
        controller.getSnapshot().isUnchanged &&
        state.extensionDirtyRef.current
      ) {
        await submitExtensionsOnly();
        // skip: extension-only save needs no entity write
        return;
      }
      let result = customSubmit !== undefined ? blockedCustomSubmitResult() : undefined;
      if (result === undefined && customSubmit !== undefined) {
        const snapshot = controller.getSnapshot();
        result = await customSubmit(
          payloadPatch === undefined ? snapshot : snapshotWithPayloadPatch(snapshot, payloadPatch),
        );
        if (result.isSuccess) adoptCustomSubmitted(payloadPatch);
      } else if (result === undefined) {
        result = await controller.submit({
          payloadPatch,
          omitFields: untouchedGatedFieldsOnCreate(),
        });
      }
      let extensionsPersisted = true;
      if (result.isSuccess)
        extensionsPersisted = await handleSubmitSuccess(
          result.isNoOp === true,
          createdEntityIdOf(result.data),
        );
      else applySubmitFailure(result);
      // On entity-success-but-extension-failure the extension-error
      // banner is showing — don't notify (the caller navigates away on success
      // and would unmount it before the user sees the failure).
      if (shouldNotifyCaller(result, extensionsPersisted)) {
        props.onSubmit?.(result, controller.getSnapshot().values);
      }
    } finally {
      isSubmittingRef.current = false;
      state.setIsSubmitting(false);
    }
  };
}
