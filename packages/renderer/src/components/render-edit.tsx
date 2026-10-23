import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import { extensionSectionName, useExtensionSectionComponent } from "../app/extension-sections.tsx";
import type { FormValues } from "../headless/index.ts";
import { renderEditLayout } from "./render-edit-layout.tsx";
import { deriveFooterFlags, deriveLayoutFlags } from "./render-edit-layout-flags.ts";
import {
  type RenderEditEngine,
  type RenderEditEngineBase,
  type RenderEditModel,
  resolveRenderEditProps,
} from "./render-edit-render-model.ts";
import { createHandleSubmit } from "./render-edit-submit.ts";
import { deriveTitles } from "./render-edit-titles.ts";
import type { RenderEditProps } from "./render-edit-types.ts";
import { createWizardNavigation } from "./render-edit-wizard-navigation.ts";
import { useRenderEditControlledSync } from "./use-render-edit-controlled-sync.ts";
import { useRenderEditDraftSave } from "./use-render-edit-draft-save.ts";
import { useRenderEditForm } from "./use-render-edit-form.ts";
import { useRenderEditSections } from "./use-render-edit-sections.ts";
import { useRenderEditState } from "./use-render-edit-state.ts";
import { useRenderEditSteps } from "./use-render-edit-steps.ts";
import { buildWizardDraftActions } from "./use-wizard-form-draft.ts";

export type {
  RenderEditAction,
  RenderEditChangeState,
  RenderEditControls,
  RenderEditProps,
} from "./render-edit-types.ts";

function footerSlotName(screen: EntityEditScreenDefinition): string | undefined {
  const footerSlot = screen.slots?.footer;
  return footerSlot !== undefined ? extensionSectionName(footerSlot) : undefined;
}

export function RenderEdit<TValues extends FormValues, TCtx = unknown>(
  rawProps: RenderEditProps<TValues, TCtx>,
): ReactNode {
  const props = resolveRenderEditProps(rawProps);
  const state = useRenderEditState({
    screen: props.screen,
    entityId: props.entityId,
    translate: props.translate,
  });
  const form = useRenderEditForm(props, state);
  const draft = useRenderEditDraftSave(props, state, form);
  const core = { props, state, form, draft };
  useRenderEditControlledSync(core);
  const sections = useRenderEditSections(core);
  const steps = useRenderEditSteps({ ...core, sections });
  const stepped = { ...core, sections, steps };

  const draftActions = buildWizardDraftActions<TValues>({
    screenId: props.screen.id,
    isCreateMode: state.isCreateMode,
    draftEnabled: state.draftEnabled,
    disabled: props.disabled,
    dispatcher: state.dispatcher,
    draftStorage: state.draftStorage,
    controller: form.controller,
    sections: sections.vm.sections,
    draftSaveTimerRef: draft.refs.draftSaveTimerRef,
    draftState: state.draftState,
  });
  draft.refs.saveDraftRef.current = draftActions.saveDraft;
  const nav = createWizardNavigation(stepped, draftActions.saveDraft);
  const base: RenderEditEngineBase<TValues, TCtx> = { ...stepped, draftActions, nav };
  const handleSubmit = createHandleSubmit(base);
  draft.refs.handleSubmitRef.current = handleSubmit;
  draft.refs.wizardNextRef.current = state.isWizard ? nav.handleWizardNext : () => {};
  draft.refs.wizardBackRef.current = state.isWizard ? nav.handleWizardBack : () => {};

  const engine: RenderEditEngine<TValues, TCtx> = { ...base, handleSubmit };
  const layout = deriveLayoutFlags(engine);
  // An unregistered footer component renders null, so only a resolvable one may
  // count as an action (else read-only screens get an empty footer strip).
  const footerSlotComponent = useExtensionSectionComponent(footerSlotName(props.screen));
  const footer = deriveFooterFlags(engine, layout, footerSlotComponent);
  const titles = deriveTitles(engine, layout, footer);
  const model: RenderEditModel<TValues, TCtx> = {
    engine,
    layout,
    footer,
    titles,
    setFieldUntyped: form.controller.setField as (k: string, v: unknown) => void,
    // @cast-boundary form-values: ExtensionSectionProps is not generic
    // over TValues; controller is mount-lifetime-stable, see the onControlsReady effect in useRenderEditDraftSave.
    patchForExtension: draft.patchAndScheduleDraftSave as (
      partial: Readonly<Record<string, unknown>>,
    ) => void,
  };
  return renderEditLayout(model);
}
