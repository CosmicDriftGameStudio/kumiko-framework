import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { layoutEditFields } from "../app/layout-fields.ts";
import type {
  Command,
  DispatcherError,
  EditFieldViewModel,
  FormSnapshot,
  FormValues,
  SubmitResult,
  Translate,
} from "../headless/index.ts";
import { InsideDrawerProvider } from "../inside-drawer.ts";
import { PageHeaderSlotAvailableProvider } from "../page-header-slot.ts";
import { RenderEdit } from "./render-edit.tsx";
import {
  FIELD_APPROVAL_REJECT_CHANGE,
  FIELD_APPROVAL_REQUEST_CHANGE,
  type PendingApprovalRequest,
} from "./render-edit-logic.ts";
import type { RenderEditModel } from "./render-edit-render-model.ts";
import { displayTextOf } from "./render-field-control.tsx";

const NOTHING_TO_FILE: SubmitResult<unknown> = {
  validationBlocked: false,
  isSuccess: true,
  isNoOp: true,
  data: undefined,
};

const REQUESTS_FILED: SubmitResult<unknown> = {
  validationBlocked: false,
  isSuccess: true,
  data: undefined,
};

export function isApprovalGatedField<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  fieldName: string,
): boolean {
  return model.engine.state.fieldApproval.gatedFields.includes(fieldName);
}

// A gated field typed into before the gate was known stays editable until reverted, otherwise the
// typed value would be stuck in a field the user can no longer change.
export function isApprovalLockedField<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  fieldName: string,
): boolean {
  return (
    isApprovalGatedField(model, fieldName) && !(fieldName in model.engine.form.snapshot.changes)
  );
}

// The field still holds its saved value, so the hint names the requested one; a writeOnly value
// never shows, and a request the caller may not read carries none. A reference value is a record
// id whose label needs a live lookup, so it is left out rather than shown raw.
function pendingRequestText(
  field: EditFieldViewModel,
  request: PendingApprovalRequest,
  translate: Translate,
  appLocale: string,
): string {
  const { requestedValue } = request;
  if (
    requestedValue === undefined ||
    field.type === "reference" ||
    (field.type === "text" && field.writeOnly === true)
  ) {
    return translate("kumiko.form.fieldApproval.pending");
  }
  return translate("kumiko.form.fieldApproval.pendingValue", {
    value: displayTextOf({ ...field, value: requestedValue }, appLocale, translate),
  });
}

function openRequestFor<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  fieldName: string,
): PendingApprovalRequest | undefined {
  return model.engine.state.fieldApproval.requests.find(
    (request) => request.fieldName === fieldName,
  );
}

// The server refuses a second request while someone else's is open, so the field offers none.
function isRequestedByOther<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  fieldName: string,
): boolean {
  return (
    isApprovalGatedField(model, fieldName) &&
    openRequestFor(model, fieldName)?.filedByCaller === false
  );
}

function renderPendingRequestHint<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  field: EditFieldViewModel,
): ReactNode {
  const { state } = model.engine;
  const request = openRequestFor(model, field.field);
  if (request === undefined) return undefined;
  const { Text } = state.primitives;
  return (
    <Text variant="muted" announce testId={`field-approval-pending-${field.field}`}>
      {isRequestedByOther(model, field.field)
        ? state.translate("kumiko.form.fieldApproval.pendingByOther")
        : pendingRequestText(field, request, state.translate, state.appLocale)}
    </Text>
  );
}

function WithdrawRequestButton<TValues extends FormValues, TCtx>({
  model,
  request,
}: {
  readonly model: RenderEditModel<TValues, TCtx>;
  readonly request: PendingApprovalRequest;
}): ReactNode {
  const { state } = model.engine;
  const { Button } = state.primitives;
  const [withdrawing, setWithdrawing] = useState(false);
  const withdraw = async (): Promise<void> => {
    // skip: no server to withdraw at
    if (state.dispatcher === undefined) return;
    setWithdrawing(true);
    try {
      const result = await state.dispatcher.write(FIELD_APPROVAL_REJECT_CHANGE, {
        id: request.id,
        version: request.version,
      });
      if (!result.isSuccess) {
        state.setFormError(result.error);
        return;
      }
      state.fieldApproval.reload();
      state.notifyAction?.({
        tone: "success",
        text: state.translate("kumiko.form.fieldApproval.withdrawn"),
      });
    } finally {
      setWithdrawing(false);
    }
  };
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      disabled={withdrawing}
      onClick={() => void withdraw()}
      testId={`field-approval-withdraw-${request.fieldName}`}
    >
      {state.translate("kumiko.form.fieldApproval.withdraw")}
    </Button>
  );
}

export function fieldApprovalAppendix<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  field: EditFieldViewModel,
): ReactNode | undefined {
  const { props, state } = model.engine;
  const { Button, Grid, Text } = state.primitives;
  const { translate, fieldApproval } = state;
  const fieldName = field.field;
  const gated = isApprovalGatedField(model, fieldName);
  if (state.isCreateMode) {
    if (!gated) return undefined;
    return (
      <Text variant="muted" testId={`field-approval-after-create-${fieldName}`}>
        {translate("kumiko.form.fieldApproval.afterCreate")}
      </Text>
    );
  }
  const request = openRequestFor(model, fieldName);
  if (request === undefined && !gated) return undefined;
  const actionsAllowed = props.disabled !== true;
  const ownRequest = request?.filedByCaller === true;
  // One wrapping row: on a phone the link drops below the hint as a whole instead of running into it.
  return (
    <Grid columns="auto" tight>
      {renderPendingRequestHint(model, field)}
      {actionsAllowed && request !== undefined && ownRequest && (
        <WithdrawRequestButton model={model} request={request} />
      )}
      {actionsAllowed && gated && request === undefined && field.visible && !field.readOnly && (
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => fieldApproval.setDrawerOpen(true)}
          testId={`field-approval-request-${fieldName}`}
        >
          {translate("kumiko.form.fieldApproval.requestChange")}
        </Button>
      )}
    </Grid>
  );
}

function requestableFields<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): readonly EditFieldViewModel[] {
  return model.engine.sections.filteredSections.flatMap((section) =>
    section.kind === "fields" && section.visible
      ? section.fields.filter(
          (field) =>
            field.visible &&
            !field.readOnly &&
            isApprovalGatedField(model, field.field) &&
            !isRequestedByOther(model, field.field),
        )
      : [],
  );
}

// Request-change reports its issues at `value`; in the batch they belong to the field whose
// command failed, and a denial without issues still has to land on that field.
function issuesOnRequestedField(error: DispatcherError, fieldName: string | undefined) {
  if (fieldName === undefined) return error;
  const issues = error.details?.fields ?? [];
  return {
    ...error,
    details: {
      ...error.details,
      fields:
        issues.length > 0
          ? issues.map((issue) => ({ ...issue, path: fieldName }))
          : [{ path: fieldName, code: error.code, i18nKey: error.i18nKey }],
    },
  };
}

function FieldApprovalDrawer<TValues extends FormValues, TCtx>({
  model,
}: {
  readonly model: RenderEditModel<TValues, TCtx>;
}): ReactNode {
  const { props, state, form } = model.engine;
  const { Drawer, Dialog } = state.primitives;
  const { translate, fieldApproval, dispatcher } = state;
  const [hasUnsavedInput, setHasUnsavedInput] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  // The whole saved record, so visible/readOnly conditions of the requested fields evaluate
  // against the same values as in the form; only changed fields are filed.
  const [initial] = useState<FormValues>(() => form.controller.getSnapshot().initial);
  const fields = requestableFields(model);
  const fieldNamesKey = fields.map((field) => field.field).join("|");
  const entityType = props.screen.entity;
  const entityId = props.entityId;
  const drawerScreen = useMemo((): EntityEditScreenDefinition => {
    const names = new Set(fieldNamesKey.split("|"));
    return {
      id: `${props.screen.id}-field-approval`,
      type: "entityEdit",
      entity: entityType,
      layout: {
        sections: [
          { fields: layoutEditFields(props.screen).filter((spec) => names.has(spec.field)) },
        ],
      },
    };
  }, [props.screen, entityType, fieldNamesKey]);
  const close = useCallback(() => {
    setHasUnsavedInput(false);
    setConfirmDiscardOpen(false);
    fieldApproval.setDrawerOpen(false);
  }, [fieldApproval.setDrawerOpen]);
  const requestClose = (): void => {
    if (hasUnsavedInput) setConfirmDiscardOpen(true);
    else close();
  };
  // One atomic batch: fields that only make sense together (IBAN and BIC) are filed together.
  const fileRequests = useCallback(
    async (snapshot: FormSnapshot<FormValues>): Promise<SubmitResult<unknown>> => {
      const fieldNames = Object.keys(snapshot.changes);
      if (fieldNames.length === 0 || dispatcher === undefined || typeof entityId !== "string") {
        return NOTHING_TO_FILE;
      }
      const commands: Command[] = fieldNames.map((fieldName) => ({
        type: FIELD_APPROVAL_REQUEST_CHANGE,
        payload: { entityType, entityId, fieldName, value: snapshot.changes[fieldName] },
      }));
      const result = await dispatcher.batch(commands);
      if (!result.isSuccess) {
        return {
          validationBlocked: false,
          isSuccess: false,
          error: issuesOnRequestedField(result.error, fieldNames[result.failedIndex]),
        };
      }
      return REQUESTS_FILED;
    },
    [dispatcher, entityType, entityId],
  );
  return (
    <>
      <Drawer
        open={true}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
        title={translate("kumiko.form.fieldApproval.requestChange")}
        subtitle={translate("kumiko.form.fieldApproval.drawerHint")}
        testId="render-edit-field-approval-drawer"
      >
        <PageHeaderSlotAvailableProvider value={false}>
          <InsideDrawerProvider value={true}>
            <RenderEdit
              screen={drawerScreen}
              entity={props.entity}
              featureName={props.featureName}
              entityId={entityId}
              initial={initial}
              payloadMode="changes"
              customSubmit={fileRequests}
              markChangedFields
              submitLabel="kumiko.form.fieldApproval.submit"
              {...(props.translate !== undefined && { translate: props.translate })}
              fieldAppendixPlacement="below-control"
              fieldAppendix={(fieldName) => {
                const field = fields.find((candidate) => candidate.field === fieldName);
                return field === undefined ? undefined : renderPendingRequestHint(model, field);
              }}
              onDirtyChange={setHasUnsavedInput}
              submitBlocked={!hasUnsavedInput}
              onCancel={requestClose}
              onSubmit={(result) => {
                // skip: blocked, failed or nothing filed; the drawer stays open
                if (result.validationBlocked || !result.isSuccess || result.isNoOp === true) return;
                // No toast: it would cover the form's Save, and the hint at the field is the answer.
                close();
                fieldApproval.reload();
              }}
            />
          </InsideDrawerProvider>
        </PageHeaderSlotAvailableProvider>
      </Drawer>
      <Dialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        title={translate("kumiko.drawer.discard.title")}
        description={translate("kumiko.drawer.discard.body")}
        confirmLabel={translate("kumiko.drawer.discard.confirm")}
        cancelLabel={translate("kumiko.drawer.discard.cancel")}
        variant="danger"
        initialFocus="cancel"
        onConfirm={close}
        testId="render-edit-field-approval-discard-dialog"
      />
    </>
  );
}

export function renderFieldApprovalDrawer<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): ReactNode {
  return model.engine.state.fieldApproval.drawerOpen && <FieldApprovalDrawer model={model} />;
}
