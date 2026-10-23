import { dispatcherErrorText } from "@cosmicdrift/kumiko-renderer";
import type { LeaveTarget } from "./mail-dialogs.tsx";
import { parseLinkedResources } from "./mail-draft.ts";
import {
  type MailEditorBodyProps,
  mailSaveFlags,
  railValidationOf,
  resourcePreviewsOfMail,
  testMailPayload,
  vocabularyOf,
} from "./mail-editor-logic.ts";
import { footerMessage, metaFieldMessages } from "./mail-footer.ts";
import type { MailDraft, MailValidation, PickedValues } from "./mail-types.ts";
import type { MailServices, MailUiState } from "./use-mail-editor-parts.ts";
import { templateTitleText } from "./used-by-label.ts";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

export type MailModelInput = {
  readonly props: MailEditorBodyProps;
  readonly t: Translate;
  readonly ui: MailUiState;
  readonly picked: PickedValues | null;
  readonly setPicked: (next: PickedValues | null) => void;
  readonly services: MailServices;
  readonly validation: MailValidation | null;
  readonly variableSchema: Readonly<Record<string, unknown>>;
  readonly pickedVariables: PickedValues | null;
  readonly locked: boolean;
  readonly dirty: boolean;
};

function mailActions(input: MailModelInput) {
  const { props, ui, services } = input;
  const { draft, baseline, settle } = ui;
  const { persistence } = services;

  const update = (patch: Partial<MailDraft>): void => {
    const next = { ...draft, ...patch };
    ui.setDraft(next);
    settle(next);
  };
  const reset = (): void => {
    ui.setDraft(baseline);
    settle(baseline);
    ui.setEditorEpoch((epoch) => epoch + 1);
    persistence.clearError();
  };
  const saveAndReload = async (publish: boolean): Promise<void> => {
    if ((await persistence.save(draft, publish)) !== "failed") await props.onReload();
  };
  const perform = (target: LeaveTarget): void => props.onLocaleChange(target.locale);
  const leave = (target: LeaveTarget): void => {
    // skip: the target locale is already open
    if (target.locale === props.locale) return;
    if (input.dirty) ui.setDialog({ kind: "leave", target });
    else perform(target);
  };
  const leaveSave = async (target: LeaveTarget): Promise<void> => {
    if ((await persistence.save(draft, false)) === "saved") perform(target);
  };
  return { update, reset, saveAndReload, perform, leave, leaveSave };
}

function resourceActions(input: MailModelInput, uploadTemplateId: string | null) {
  const { props, t, ui, services } = input;
  const removeResource = async (key: string): Promise<void> => {
    // skip: only tenant rows own removable resources
    if (uploadTemplateId === null) return;
    ui.setResourceError(null);
    const result = await services.resourceRemove.mutate({ templateId: uploadTemplateId, key });
    if (result.isSuccess) await props.onRefreshRow();
    else ui.setResourceError(dispatcherErrorText(result.error, t));
  };
  const sendTestMail = (): void => {
    void services.testMail.send(
      testMailPayload({
        slug: props.slug,
        locale: props.locale,
        draft: ui.draft,
        variableSchema: input.variableSchema,
        includeAttachments: ui.includeAttachments,
        prefixSubject: ui.prefixSubject,
        pickedVariables: input.pickedVariables,
      }),
    );
  };
  return { removeResource, sendTestMail };
}

export function buildMailModel(input: MailModelInput) {
  const { props, t, ui, services, validation, locked } = input;
  const { row } = props;
  const busy = services.persistence.busy;
  const { canSave, canPublish } = mailSaveFlags({
    locked,
    busy,
    validation,
    dirty: input.dirty,
    creating: ui.creating,
    row,
  });
  const resources = parseLinkedResources(row?.linkedResources);
  const pdfTitles = new Map(
    services.pdfTemplates.rows.map((template) => [
      template.slug,
      templateTitleText(t, template.title),
    ]),
  );
  const uploadTemplateId = row?.scope === "tenant" ? row.id : null;
  const footer =
    locked || validation === undefined || validation === null
      ? null
      : footerMessage(
          t,
          validation,
          ui.mode === "preview" && services.testMail.availability.canSend,
        );

  return {
    ui,
    services,
    validation,
    picked: input.picked,
    setPicked: input.setPicked,
    pickedVariables: input.pickedVariables,
    variableSchema: input.variableSchema,
    locked,
    dirty: input.dirty,
    busy,
    canSave,
    canPublish,
    ...mailActions(input),
    ...resourceActions(input, uploadTemplateId),
    resources,
    pdfTitles,
    uploadTemplateId,
    takenKeys: resources.map((resource) => resource.key),
    attachments: resources.filter((resource) => resource.kind !== "image"),
    resourcePreviews: resourcePreviewsOfMail(resources, t),
    railValidation: railValidationOf(locked, validation),
    vocabulary: vocabularyOf(t, validation),
    footer,
    fieldErrors: locked ? {} : metaFieldMessages(t, validation),
  };
}

export type MailEditorModel = ReturnType<typeof buildMailModel>;
