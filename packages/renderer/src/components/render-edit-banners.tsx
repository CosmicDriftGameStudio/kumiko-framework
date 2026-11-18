import type { ReactNode } from "react";
import { ErrorReference } from "../app/error-reference.tsx";
import { unprocessableReasonText } from "../app/write-failed-error.ts";
import { formatWhen } from "../format-when.ts";
import type { Dispatcher, DispatcherError, FormValues } from "../headless/index.ts";
import { tabIdAt } from "./render-edit-helpers.tsx";
import {
  FIELD_APPROVAL_REQUEST_CHANGE,
  isDispatcherRejection,
  isFieldApprovalRequired,
} from "./render-edit-logic.ts";
import type { RenderEditModel } from "./render-edit-render-model.ts";
import type { RenderEditState } from "./use-render-edit-state.ts";

export function renderAllRequiredHint<TValues extends FormValues, TCtx>({
  engine: { state },
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Text } = state.primitives;
  return (
    <Text variant="muted" testId="render-edit-all-required-hint">
      {state.translate("kumiko.form.all-required")}
    </Text>
  );
}

export function renderDraftPicker<TValues extends FormValues, TCtx>({
  engine: { state, draftActions },
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Banner, Button, Text } = state.primitives;
  const { translate } = state;
  const { draftCandidates, setDraftCandidates } = state.draftState;
  return (
    draftCandidates !== null && (
      <Banner
        variant="info"
        testId="render-edit-draft-picker"
        actions={[
          ...draftCandidates.map((candidate) => (
            <Button
              key={candidate.id}
              type="button"
              variant="link"
              onClick={() => draftActions.adoptDraft(candidate)}
              testId={`render-edit-draft-pick-${candidate.id}`}
            >
              {formatWhen(candidate.savedAt)}
            </Button>
          )),
          <Button
            key="start-new"
            type="button"
            variant="link"
            onClick={() => setDraftCandidates(null)}
            testId="render-edit-draft-start-new"
          >
            {translate("kumiko.form.draft.start-new")}
          </Button>,
        ]}
      >
        <Text>
          {translate(
            draftCandidates.length === 1
              ? "kumiko.form.draft.resume-single"
              : "kumiko.form.draft.resume-multiple",
          )}
        </Text>
      </Banner>
    )
  );
}

export function renderWizardProgress<TValues extends FormValues, TCtx>({
  engine: { state, steps, sections, nav },
  titles,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Progress, StepBar } = state.primitives;
  const { currentStep, lastStepIndex, updateModeStepBarProps } = steps;
  return (
    state.isWizard &&
    !titles.stepRail && (
      <>
        <Progress
          value={(currentStep + 1) / (lastStepIndex + 1)}
          testId="render-edit-wizard-progress"
        />
        <StepBar
          steps={sections.filteredSections.map((section) => section.title ?? "")}
          currentIndex={currentStep}
          compactLabel={titles.compactStepLabel}
          onStepSelect={nav.handleWizardStepSelect}
          {...updateModeStepBarProps}
          testId="render-edit-wizard-steps"
          compactTestId="render-edit-wizard-step-label"
        />
      </>
    )
  );
}

export function renderTabStrip<TValues extends FormValues, TCtx>({
  engine: { state, steps, sections, nav },
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Tabs } = state.primitives;
  const { filteredSections } = sections;
  return (
    <Tabs
      testId="render-edit-tabs"
      items={filteredSections.map((section, index) => ({
        id: tabIdAt(section, index),
        label: section.title ?? "",
      }))}
      activeId={tabIdAt(filteredSections[steps.currentStep], steps.currentStep)}
      onSelect={(id) => {
        const index = filteredSections.findIndex((s, i) => tabIdAt(s, i) === id);
        // skip: the strip reported an id no section owns.
        if (index === -1) return;
        nav.jumpToStep(index);
      }}
    />
  );
}

// Files each gated field's new value as a change request, puts the field back to its saved
// value and then saves the remaining changes the normal way.
async function submitForApproval<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  dispatcher: Dispatcher,
  entityId: string,
  fields: readonly string[],
): Promise<void> {
  const { props, state, form, handleSubmit } = model.engine;
  const { values, initial } = form.controller.getSnapshot();
  for (const fieldName of fields) {
    const result = await dispatcher.write(FIELD_APPROVAL_REQUEST_CHANGE, {
      entityType: props.screen.entity,
      entityId,
      fieldName,
      value: values[fieldName],
    });
    if (!result.isSuccess) {
      state.setFormError(result.error);
      return;
    }
  }
  for (const fieldName of fields) {
    model.setFieldUntyped(fieldName, initial[fieldName]);
    form.controller.clearErrors(fieldName);
  }
  state.setPendingApprovalFields(fields);
  state.setFormError(null);
  if (form.controller.getSnapshot().isDirty) await handleSubmit({ saveNow: true });
}

function renderFieldApprovalParts<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  formError: DispatcherError,
): { readonly text: ReactNode; readonly action: ReactNode } | undefined {
  // skip: not a field-approval denial
  if (!isFieldApprovalRequired(formError)) return undefined;
  const { props, state, sections } = model.engine;
  const { Button, Text } = state.primitives;
  const fields = (formError.details?.fields ?? []).map((issue) => issue.path);
  const shownFields = sections.filteredSections.flatMap((s) =>
    s.kind === "fields" ? s.fields : [],
  );
  const labels = fields.map((name) => shownFields.find((f) => f.field === name)?.label ?? name);
  const { dispatcher } = state;
  const entityId = props.entityId;
  const canSubmit =
    state.fieldApprovalMounted &&
    dispatcher !== undefined &&
    typeof entityId === "string" &&
    !state.isCreateMode &&
    fields.length > 0;
  return {
    text: (
      <Text testId="render-edit-field-approval-fields">
        {state.translate("kumiko.form.fieldApproval.fields", { fields: labels.join(", ") })}
      </Text>
    ),
    action: canSubmit && (
      <Button
        variant="secondary"
        onClick={() => void submitForApproval(model, dispatcher, entityId, fields)}
        testId="render-edit-field-approval-submit"
      >
        {state.translate("kumiko.form.fieldApproval.submit")}
      </Button>
    ),
  };
}

export function renderFormErrorBanner<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): ReactNode {
  const {
    engine: { props, state },
    layout,
  } = model;
  const { Banner, Button, Text } = state.primitives;
  const { translate, formError } = state;
  const { onReload } = props;
  const approval = formError === null ? undefined : renderFieldApprovalParts(model, formError);
  return (
    formError !== null && (
      <Banner
        variant="error"
        testId="render-edit-form-error"
        actions={
          approval?.action ? (
            approval.action
          ) : formError.code === "version_conflict" && onReload !== undefined ? (
            <Button
              variant="secondary"
              onClick={() => {
                onReload();
                state.setFormError(null);
                state.setExtraDeleteIssues([]);
              }}
              testId="render-edit-form-error-reload"
            >
              {translate("kumiko.actions.reload")}
            </Button>
          ) : undefined
        }
      >
        <Text testId="render-edit-form-error-key">
          {unprocessableReasonText(formError, translate) ??
            translate(formError.i18nKey, formError.i18nParams)}
        </Text>
        {approval?.text}
        {layout.rootIssues.map((issue) => (
          <Text key={`${issue.path}:${issue.i18nKey}`} testId="render-edit-form-error-root">
            {translate(issue.i18nKey, issue.params)}
          </Text>
        ))}
        {layout.unplacedIssues.map((issue) => (
          <Text key={`${issue.path}:${issue.i18nKey}`} testId="render-edit-form-error-unplaced">
            {translate(issue.i18nKey, issue.params)}
          </Text>
        ))}
        {state.extraDeleteIssues.map((issue) => (
          <Text key={`${issue.path}:${issue.i18nKey}`} testId="render-edit-form-error-extra">
            {translate(issue.i18nKey, issue.params)}
          </Text>
        ))}
      </Banner>
    )
  );
}

export function renderRootIssueBanners<TValues extends FormValues, TCtx>({
  engine: { state },
  layout,
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Banner, Text } = state.primitives;
  return (
    state.formError === null &&
    layout.rootIssues.map((issue) => (
      <Banner variant="error" testId="render-edit-root-issue" key={issue.i18nKey}>
        <Text>{state.translate(issue.i18nKey, issue.params)}</Text>
      </Banner>
    ))
  );
}

export function renderExtensionErrorBanner<TValues extends FormValues, TCtx>({
  engine: { state },
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Banner, Text } = state.primitives;
  const { extensionErrorKey } = state;
  return (
    extensionErrorKey !== null && (
      <Banner variant="error" testId="render-edit-extension-error">
        <Text testId="render-edit-extension-error-key">{state.translate(extensionErrorKey)}</Text>
      </Banner>
    )
  );
}

export function renderActionErrorBanner<TValues extends FormValues, TCtx>({
  engine: { state },
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Banner } = state.primitives;
  const { actionError } = state;
  return (
    actionError !== null && (
      <Banner variant="error" testId="render-edit-action-error">
        {actionError.message}
        <ErrorReference requestId={actionError.requestId} />
      </Banner>
    )
  );
}

// A rejected delete (e.g. a preDelete hook) carries its reason in
// the field issues; the top-level key is only "validation failed".
function applyDeleteRejection(state: RenderEditState, rejection: DispatcherError): void {
  const [issue, ...otherIssues] = rejection.details?.fields ?? [];
  state.setExtraDeleteIssues(otherIssues);
  state.setFormErrorSource("delete");
  state.setFormError(
    issue === undefined
      ? rejection
      : { ...rejection, i18nKey: issue.i18nKey, i18nParams: issue.params },
  );
}

export function renderDeleteDialog<TValues extends FormValues, TCtx>({
  engine: { props, state },
}: RenderEditModel<TValues, TCtx>): ReactNode {
  const { Dialog } = state.primitives;
  const { onDelete } = props;
  return (
    onDelete !== undefined && (
      <Dialog
        open={state.confirmDeleteOpen}
        onOpenChange={state.setConfirmDeleteOpen}
        title={state.translate("kumiko.actions.delete-confirm")}
        confirmLabel={state.translate("kumiko.actions.delete")}
        variant="danger"
        onConfirm={async () => {
          const rejection = await onDelete();
          if (isDispatcherRejection(rejection)) applyDeleteRejection(state, rejection);
        }}
        testId="render-edit-delete-dialog"
      />
    )
  );
}
