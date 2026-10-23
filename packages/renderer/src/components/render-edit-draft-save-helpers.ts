import type { MutableRefObject } from "react";
import type { FormValues } from "../headless/index.ts";
import { dryRunFieldIssues } from "./render-edit-helpers.tsx";
import type { ResolvedRenderEditProps } from "./render-edit-render-model.ts";
import type { RenderEditForm } from "./use-render-edit-form.ts";

type ControlsOf<TValues extends FormValues> = Parameters<
  NonNullable<ResolvedRenderEditProps<TValues>["onControlsReady"]>
>[0];
type ChangeStateOf<TValues extends FormValues> = Parameters<
  NonNullable<ResolvedRenderEditProps<TValues>["onChange"]>
>[0];

export function flushPendingDraftSave(
  draftSaveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  saveDraftRef: MutableRefObject<(stepIndex: number) => void>,
  currentStepRef: MutableRefObject<number>,
): void {
  if (draftSaveTimerRef.current !== null) {
    clearTimeout(draftSaveTimerRef.current);
    // Flush the pending debounced save instead of dropping it — a
    // navigation/unmount inside the debounce window would otherwise
    // silently discard the last patch() (discardDraft nulls this ref
    // first on the post-submit path, so this can't resurrect a
    // just-submitted draft).
    saveDraftRef.current(currentStepRef.current);
  }
}

export function buildControlsFor<TValues extends FormValues>({
  controller,
  patch,
  validate,
  handleSubmitRef,
  wizardNextRef,
  wizardBackRef,
}: {
  readonly controller: RenderEditForm<TValues>["controller"];
  readonly patch: ControlsOf<TValues>["patch"];
  readonly validate: ControlsOf<TValues>["validate"];
  readonly handleSubmitRef: MutableRefObject<
    (options?: { readonly saveNow?: boolean }) => Promise<void>
  >;
  readonly wizardNextRef: MutableRefObject<() => void>;
  readonly wizardBackRef: MutableRefObject<() => void>;
}): ControlsOf<TValues> {
  return {
    patch,
    validate,
    getValues: () => controller.getSnapshot().values,
    // saveNow: a host-driven submit must save on a wizard's intermediate
    // steps too instead of silently advancing; stepping is next()/back().
    submit: () => handleSubmitRef.current({ saveNow: true }),
    next: () => wizardNextRef.current(),
    back: () => wizardBackRef.current(),
  };
}

export function deriveChangeState<TValues extends FormValues>(
  snapshot: RenderEditForm<TValues>["snapshot"],
  schema: ResolvedRenderEditProps<TValues>["schema"],
  scopeFieldNames: readonly string[] | undefined,
  submitting: boolean,
): ChangeStateOf<TValues> {
  // Dry-run parse against `schema` — NOT controller.validate(). Calling
  // validate() here would write field-level errors into snapshot.errors
  // on every keystroke, painting error messages while the user is still
  // typing. `valid` can therefore legitimately diverge from what's
  // currently rendered under the fields (the last *mutating* validate()
  // call, e.g. from controls.validate() or submit()). The issues are
  // filtered exactly like submit()'s validate: hidden fields and fields
  // outside the `fields` scope never make the form invalid.
  const valid =
    schema === undefined || dryRunFieldIssues(schema, snapshot, scopeFieldNames, true).length === 0;
  return {
    values: snapshot.values,
    changes: snapshot.changes,
    dirty: snapshot.isDirty,
    valid,
    submitting,
  };
}
