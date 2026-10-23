import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import type { FormValues } from "../headless/index.ts";
import {
  buildControlsFor,
  deriveChangeState,
  flushPendingDraftSave,
} from "./render-edit-draft-save-helpers.ts";
import type { ResolvedRenderEditProps } from "./render-edit-render-model.ts";
import type { RenderEditForm } from "./use-render-edit-form.ts";
import type { RenderEditState } from "./use-render-edit-state.ts";
import { PATCH_DRAFT_SAVE_DEBOUNCE_MS } from "./use-wizard-form-draft.ts";

export type RenderEditRefs<TValues extends FormValues> = {
  readonly onChangeRef: MutableRefObject<ResolvedRenderEditProps<TValues>["onChange"]>;
  readonly deliveredControlsToRef: MutableRefObject<
    ResolvedRenderEditProps<TValues>["onControlsReady"]
  >;
  readonly onControlsReadyRef: MutableRefObject<
    ResolvedRenderEditProps<TValues>["onControlsReady"]
  >;
  readonly hasNavigatedRef: MutableRefObject<boolean>;
  readonly submittedRef: MutableRefObject<boolean>;
  readonly isSubmittingRef: MutableRefObject<boolean>;
  readonly scopeFieldNamesRef: MutableRefObject<readonly string[] | undefined>;
  readonly saveDraftRef: MutableRefObject<(stepIndex: number) => void>;
  readonly handleSubmitRef: MutableRefObject<
    (options?: { readonly saveNow?: boolean }) => Promise<void>
  >;
  readonly wizardNextRef: MutableRefObject<() => void>;
  readonly wizardBackRef: MutableRefObject<() => void>;
  readonly currentStepRef: MutableRefObject<number>;
  readonly draftSaveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
};

export type RenderEditDraft<TValues extends FormValues> = {
  readonly refs: RenderEditRefs<TValues>;
  readonly scopedValidate: () => boolean;
  readonly markSaved: (fields?: readonly string[]) => void;
  readonly patchAndScheduleDraftSave: (partial: Partial<TValues>) => void;
};

export function useRenderEditDraftSave<TValues extends FormValues, TCtx>(
  props: ResolvedRenderEditProps<TValues, TCtx>,
  state: RenderEditState,
  form: RenderEditForm<TValues>,
): RenderEditDraft<TValues> {
  const { controller, snapshot } = form;
  const { disabled, schema } = props;
  const { isSubmitting, draftEnabled, dispatcher } = state;
  // Controlled mode. Both callbacks live in refs so a
  // re-rendering caller (identity-unstable `onChange`/`onControlsReady`
  // closures, e.g. inline arrows) doesn't retrigger these effects — only a
  // real snapshot mutation (typing, patch()) does. Without this, a caller
  // whose onChange calls patch() to fill other fields (the VIN-decode use
  // case) would loop: patch → new snapshot → effect
  // re-subscribes with a "new" onChange → refires.
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  // Guards against redelivering to the SAME callback identity on every
  // render (an inline-arrow onControlsReady would otherwise refire the
  // effect below on every render since the callback itself is now a dep).
  // Tracks the actual prop, not a ref snapshot, so a caller that swaps in a
  // real handler after mount (e.g. `onControlsReady={ready ? cb : undefined}`)
  // gets delivered to for THIS mount instead of never.
  const deliveredControlsToRef = useRef<typeof props.onControlsReady>(undefined);
  const onControlsReadyRef = useRef(props.onControlsReady);
  onControlsReadyRef.current = props.onControlsReady;
  const hasNavigatedRef = useRef(false);
  const submittedRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const scopeFieldNamesRef = useRef(form.scopeFieldNames);
  scopeFieldNamesRef.current = form.scopeFieldNames;
  const scopedValidate = useCallback(
    () => controller.validate(scopeFieldNamesRef.current),
    [controller],
  );
  // The extension dirty flag aggregates every section; each section clears its
  // own part, so a host-side markSaved must not reset it.
  const markSaved = useCallback(
    (fields?: readonly string[]) => {
      if (fields === undefined) controller.rebase();
      else controller.rebaseFields(fields);
    },
    [controller],
  );
  // `saveDraft` (defined below) is a fresh closure every render, over that
  // render's `draftKey`/`draftId` — the ref lets the debounce timer below
  // always call the CURRENT one even though the timer was scheduled by an
  // earlier render's patch() call. `currentStepRef` gives it the current
  // wizard step without depending on `currentStep` (computed further down,
  // from `filteredSections`) at the point patchAndScheduleDraftSave itself
  // is defined — kept fresh where `currentStep` is computed below.
  const saveDraftRef = useRef<(stepIndex: number) => void>(() => {});
  // `handleSubmit` (defined below) is a fresh closure over this render's
  // snapshot/extensionDirty, while the onControlsReady effect fires once per
  // mount — the ref lets controls.submit() always reach the current one.
  const handleSubmitRef = useRef<(options?: { readonly saveNow?: boolean }) => Promise<void>>(
    async () => {},
  );
  const wizardNextRef = useRef<() => void>(() => {});
  const wizardBackRef = useRef<() => void>(() => {});
  const currentStepRef = useRef(0);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refs: RenderEditRefs<TValues> = {
    onChangeRef,
    deliveredControlsToRef,
    onControlsReadyRef,
    hasNavigatedRef,
    submittedRef,
    isSubmittingRef,
    scopeFieldNamesRef,
    saveDraftRef,
    handleSubmitRef,
    wizardNextRef,
    wizardBackRef,
    currentStepRef,
    draftSaveTimerRef,
  };
  useEffect(() => {
    return () => flushPendingDraftSave(draftSaveTimerRef, saveDraftRef, currentStepRef);
  }, []);

  // patch() (controlled mode, extension sections) applies immediately —
  // only the resulting draft save is debounced, so a patch() burst
  // (VIN-decode filling several fields, or onChange fanning a keystroke out
  // through patch(), see the VIN-decode test above) collapses into one save.
  const patchAndScheduleDraftSave = useCallback(
    (partial: Partial<TValues>) => {
      controller.setValues(partial);
      // skip: no draft screen, locked, or already submitted
      if (!draftEnabled || dispatcher === undefined || disabled || submittedRef.current) return;
      if (draftSaveTimerRef.current !== null) clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = setTimeout(() => {
        draftSaveTimerRef.current = null;
        // skip: locked or submitted since the timer was set
        if (disabled || submittedRef.current) return;
        saveDraftRef.current(currentStepRef.current);
      }, PATCH_DRAFT_SAVE_DEBOUNCE_MS);
    },
    [controller, draftEnabled, dispatcher, disabled],
  );

  // Runs before the onChange effect below (declaration order = React
  // execution order) so that an onChange fired on mount always sees
  // `controls !== undefined` — both effects depend only on mount-stable
  // values (controller/scopedValidate/patchAndScheduleDraftSave), so the
  // swap is otherwise a no-op. See the VIN-decode test: an initial
  // value that should derive dependent fields on mount needs controls.patch
  // available on the very first onChange call, not just from the second
  // keystroke onward.
  const hasControlsReady = props.onControlsReady !== undefined;
  useEffect(() => {
    // skip: caller registered no onControlsReady
    if (!hasControlsReady) return;
    const ready = onControlsReadyRef.current;
    // skip: callback vanished before this effect ran
    if (ready === undefined) return;
    // skip: this callback already received the controls
    if (deliveredControlsToRef.current === ready) return;
    deliveredControlsToRef.current = ready;
    ready(
      buildControlsFor({
        controller,
        patch: patchAndScheduleDraftSave,
        validate: scopedValidate,
        handleSubmitRef,
        wizardNextRef,
        wizardBackRef,
      }),
    );
    // Dep on boolean presence only — inline-arrow identity must not redeliver.
  }, [hasControlsReady, controller, scopedValidate, patchAndScheduleDraftSave]);

  // `schema` is typically an inline caller prop (`schema={z.object({...})}`)
  // with unstable identity across renders — as an effect dep it would refire
  // on every parent render, not just on a snapshot change, risking a loop if
  // the caller's onChange triggers a parent re-render. Held in a ref like
  // onChangeRef so only a real snapshot mutation retriggers this effect.
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  // Controls are guaranteed ready by the time this fires (see the
  // onControlsReady effect above, which is declared first on purpose).
  useEffect(() => {
    const cb = onChangeRef.current;
    // skip: caller registered no onChange
    if (cb === undefined) return;
    cb(deriveChangeState(snapshot, schemaRef.current, scopeFieldNamesRef.current, isSubmitting));
  }, [snapshot, isSubmitting]);

  return { refs, scopedValidate, markSaved, patchAndScheduleDraftSave };
}
