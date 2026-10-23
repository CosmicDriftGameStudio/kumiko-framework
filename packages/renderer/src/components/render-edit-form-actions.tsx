import type { ReactNode } from "react";
import type { FormValues } from "../headless/index.ts";
import {
  FOOTER_ACTION_ROLE_PROP,
  NARROW_LABEL_PROP,
  STICKY_PRIMARY_ACTION_PROP,
} from "../primitives.tsx";
import { EditSlotMount } from "./edit-mounts.tsx";
import { resolveExtensionEntityId } from "./render-edit-logic.ts";
import type { RenderEditModel } from "./render-edit-render-model.ts";

function renderWizardBackButton<TValues extends FormValues, TCtx>({
  engine: { state, nav },
  footer,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Button } = state.primitives;
  return (
    footer.showWizardBack && (
      <Button
        type="button"
        variant="secondary"
        icon="chevron-left"
        onClick={nav.handleWizardBack}
        testId="render-edit-wizard-back"
        {...{ [FOOTER_ACTION_ROLE_PROP]: "back" as const }}
      >
        {state.translate("kumiko.actions.back")}
      </Button>
    )
  );
}

function renderFooterSlot<TValues extends FormValues, TCtx>({
  engine: { props, state, form, draft, sections, steps },
  footer,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const footerSlot = props.screen.slots?.footer;
  return (
    footerSlot !== undefined && (
      <EditSlotMount
        slot={footerSlot}
        slotName="footer"
        screenId={props.screen.id}
        entityName={sections.vm.entityName}
        entityId={resolveExtensionEntityId(props.entityId, sections.vm.id)}
        values={form.snapshot.values}
        markSaved={draft.markSaved}
        hasUnsavedChanges={footer.hasUnsavedInput}
        wizardStep={
          state.isWizard ? { index: steps.currentStep, isLast: steps.isLastWizardStep } : undefined
        }
        {...(props.screen.slots?.footerPrimary === true && { [STICKY_PRIMARY_ACTION_PROP]: true })}
      />
    )
  );
}

function renderSaveAndCloseButton<TValues extends FormValues, TCtx>({
  engine: { props, state, steps, handleSubmit },
  footer,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Button } = state.primitives;
  return (
    state.isWizard &&
    !steps.isLastWizardStep &&
    footer.showsSubmit &&
    !state.isCreateMode && (
      <Button
        type="button"
        variant="ghost"
        disabled={state.isSubmitting || props.disabled}
        onClick={() => void handleSubmit({ saveNow: true })}
        testId="render-edit-wizard-save-close"
        {...{ [STICKY_PRIMARY_ACTION_PROP]: true }}
      >
        {state.translate("kumiko.wizard.save-and-close")}
      </Button>
    )
  );
}

function renderWizardNextButton<TValues extends FormValues, TCtx>({
  engine: { state },
  footer,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Button } = state.primitives;
  const { translate } = state;
  return (
    footer.showWizardNext && (
      <Button
        type="submit"
        variant="primary"
        iconEnd="chevron-right"
        testId="render-edit-wizard-next"
        {...{
          [FOOTER_ACTION_ROLE_PROP]: "primary" as const,
          [NARROW_LABEL_PROP]: translate("kumiko.actions.next"),
        }}
      >
        {footer.nextStepTitle !== undefined
          ? translate("kumiko.wizard.next-with-title", { title: footer.nextStepTitle })
          : translate("kumiko.actions.next")}
      </Button>
    )
  );
}

function renderFooterActionButtons<TValues extends FormValues, TCtx>({
  engine: { props, state, form, handleSubmit },
  footer,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Button } = state.primitives;
  return (
    footer.showSubmit &&
    props.footerActions?.map((action) => (
      <Button
        key={action.id}
        type="button"
        variant={action.variant ?? "secondary"}
        {...(action.icon !== undefined && { icon: action.icon })}
        disabled={state.isSubmitting || props.disabled}
        onClick={() => {
          form.controller.setValues(action.patch as Partial<TValues>); // @cast-boundary form-values
          void handleSubmit();
        }}
        testId={`render-edit-footer-action-${action.id}`}
      >
        {state.translate(action.label)}
      </Button>
    ))
  );
}

function renderDiscardButton<TValues extends FormValues, TCtx>({
  engine: { props, state, form },
  footer,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Button } = state.primitives;
  const { unsavedCount } = footer;
  return (
    footer.hasDirtyFooter &&
    footer.showsSubmit &&
    unsavedCount !== undefined &&
    unsavedCount > 0 && (
      <Button
        type="button"
        variant="ghost"
        disabled={state.isSubmitting || props.disabled}
        onClick={() => form.controller.reset()}
        testId="render-edit-discard"
        {...{ [STICKY_PRIMARY_ACTION_PROP]: true }}
      >
        {state.translate("kumiko.form.discard")}
      </Button>
    )
  );
}

function isSubmitDisabled<TValues extends FormValues, TCtx>({
  engine: { props, state, form },
  footer,
}: RenderEditModel<TValues, TCtx>): boolean {
  const isPristine =
    form.snapshot.isUnchanged &&
    !state.extensionDirty &&
    !footer.isFieldlessSubmitForm &&
    !state.insideDrawer &&
    props.submitWithoutChanges !== true;
  return isPristine || state.isSubmitting || props.disabled || props.submitBlocked;
}

function resolveSubmitLabelKey<TValues extends FormValues, TCtx>({
  engine: { props, state },
  footer,
}: RenderEditModel<TValues, TCtx>): string {
  if (props.submitLabel !== undefined) return props.submitLabel;
  if (state.isWizard) return "kumiko.actions.finish";
  return footer.hasDirtyFooter ? "kumiko.form.saveChanges" : "kumiko.actions.save";
}

function renderSubmitButton<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): ReactNode {
  const { props, state } = model.engine;
  const { Button } = state.primitives;
  return (
    model.footer.showSubmit && (
      <Button
        type="submit"
        disabled={isSubmitDisabled(model)}
        loading={state.isSubmitting}
        variant={props.submitVariant ?? "primary"}
        testId="render-edit-submit"
      >
        {state.translate(resolveSubmitLabelKey(model))}
      </Button>
    )
  );
}

export function renderFormActions<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): ReactNode {
  return (
    <>
      {renderWizardBackButton(model)}
      {renderFooterSlot(model)}
      {renderSaveAndCloseButton(model)}
      {renderWizardNextButton(model)}
      {renderFooterActionButtons(model)}
      {renderDiscardButton(model)}
      {renderSubmitButton(model)}
      {model.engine.sections.writeFormFooterAction}
    </>
  );
}
