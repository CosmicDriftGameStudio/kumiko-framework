import { useEffect, useRef } from "react";
import type { FormValues } from "../headless/index.ts";
import { useUnsavedInputSource } from "../leave-guard.ts";
import type { RenderEditCore } from "./render-edit-render-model.ts";
import { useWizardFormDraftRestore } from "./use-wizard-form-draft.ts";

export function useRenderEditControlledSync<TValues extends FormValues, TCtx>({
  props,
  state,
  form,
  draft,
}: RenderEditCore<TValues, TCtx>): void {
  const { controller, snapshot } = form;
  const { extensionDirty } = state;
  const onDirtyChangeRef = useRef(props.onDirtyChange);
  onDirtyChangeRef.current = props.onDirtyChange;
  const hasUnsavedInput = snapshot.isDirty || extensionDirty;
  useEffect(() => {
    onDirtyChangeRef.current?.(hasUnsavedInput);
  }, [hasUnsavedInput]);

  // Draft wizards keep their input server-side, so leaving loses nothing.
  const persistsDraft = state.isWizard && props.screen.layout.draft === true;
  useUnsavedInputSource(
    () => !persistsDraft && (controller.getSnapshot().isDirty || state.extensionDirtyRef.current),
  );

  useWizardFormDraftRestore<TValues>({
    screenId: props.screen.id,
    isCreateMode: state.isCreateMode,
    draftEnabled: state.draftEnabled,
    dispatcher: state.dispatcher,
    controller,
    hasNavigatedRef: draft.refs.hasNavigatedRef,
    setRawStep: state.setRawStep,
    draftState: state.draftState,
  });
}
