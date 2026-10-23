import type { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { EditorLocaleSwitch } from "./editor-header.tsx";
import { EditorBody } from "./editor-shell.tsx";
import { MailEditCenter } from "./mail-edit-center.tsx";
import type { MailEditorBodyProps } from "./mail-editor-logic.ts";
import type { MailEditorModel } from "./mail-editor-model.ts";
import {
  PlaceholderSection,
  ResourceSection,
  SystemPlaceholderSection,
} from "./mail-left-rail.tsx";
import { MissingLocaleCanvas } from "./mail-missing-locale.tsx";
import { PdfLinkModal } from "./mail-pdf-link-modal.tsx";
import {
  AttachmentSection,
  ChromeSection,
  PropertiesSection,
  UsageSection,
} from "./mail-right-rail.tsx";
import { UploadModal } from "./mail-upload-modal.tsx";
import { VersionsSection } from "./mail-versions.tsx";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;
type Banner = ReturnType<typeof usePrimitives>["Banner"];

export function renderMailControls(props: MailEditorBodyProps, m: MailEditorModel): ReactNode {
  return (
    <EditorLocaleSwitch
      testIdPrefix="mail"
      locales={props.locales}
      locale={props.locale}
      onLocale={(next) => m.leave({ kind: "locale", locale: next })}
    />
  );
}

export function renderMailBanners(Banner: Banner, t: Translate, m: MailEditorModel): ReactNode {
  const { testMail } = m.services;
  const { resetError, resourceError } = m.ui;
  return (
    <>
      {testMail.state.kind === "sent" && (
        <Banner variant="primary" testId="mail-test-sent">
          {t("documentDesigner.mail.testMail.sent", { subject: testMail.state.subject })}
        </Banner>
      )}
      {testMail.state.kind === "error" && (
        <Banner variant="error" testId="mail-test-error">
          {testMail.state.text}
        </Banner>
      )}
      {resetError !== null && (
        <Banner variant="error" testId="mail-reset-error">
          {resetError}
        </Banner>
      )}
      {resourceError !== null && (
        <Banner variant="error" testId="mail-resource-error">
          {resourceError}
        </Banner>
      )}
    </>
  );
}

function renderLeftRail(m: MailEditorModel): ReactNode {
  const { insert, filesAvailable } = m.services;
  const { setUploadOpen, setDialog } = m.ui;
  return (
    <>
      <PlaceholderSection validation={m.railValidation} onInsert={insert.insertPlaceholder} />
      <SystemPlaceholderSection validation={m.railValidation} onInsert={insert.insertPlaceholder} />
      <ResourceSection
        resources={m.resources}
        pdfTitles={m.pdfTitles}
        canUpload={m.uploadTemplateId !== null}
        filesAvailable={filesAvailable}
        onUpload={() => setUploadOpen(true)}
        onInsert={insert.insertResource}
        onRemove={(key) => setDialog({ kind: "remove", key })}
      />
    </>
  );
}

function renderCenterCanvas(props: MailEditorBodyProps, m: MailEditorModel): ReactNode {
  if (m.locked) {
    return (
      <MissingLocaleCanvas
        slug={props.slug}
        locale={props.locale}
        fallbackLocale={props.fallbackLocale}
        copyScope={props.isSystemAdmin ? "system" : "tenant"}
        onCreateBlank={() => m.ui.setCreating(true)}
        onCopied={() => void props.onReload()}
      />
    );
  }
  return (
    <MailEditCenter
      key={m.ui.editorEpoch}
      draft={m.ui.draft}
      vocabulary={m.vocabulary}
      resourcePreviews={m.resourcePreviews}
      insert={m.services.insert}
      readOnly={false}
      fieldErrors={m.fieldErrors}
      onChange={m.update}
    />
  );
}

function renderRightRail(props: MailEditorBodyProps, m: MailEditorModel): ReactNode {
  const { row } = props;
  return (
    <>
      <PropertiesSection
        slug={props.slug}
        draft={m.ui.draft}
        layouts={m.services.layouts.rows}
        onChange={m.update}
      />
      <ChromeSection
        draft={m.ui.draft}
        vocabulary={m.vocabulary}
        insert={m.services.insert}
        onChange={m.update}
      />
      <AttachmentSection
        attachments={m.attachments}
        pdfTitles={m.pdfTitles}
        canEdit={m.uploadTemplateId !== null}
        onAddPdf={() => m.ui.setPdfOpen(true)}
        onRemove={(key) => m.ui.setDialog({ kind: "remove", key })}
      />
      <UsageSection slug={props.slug} />
      <VersionsSection
        rowId={row?.id ?? null}
        currentVersion={row?.version ?? 0}
        currentStatus={row?.status ?? "draft"}
      />
    </>
  );
}

export function renderMailEditBody(props: MailEditorBodyProps, m: MailEditorModel): ReactNode {
  return (
    <EditorBody
      left={renderLeftRail(m)}
      center={renderCenterCanvas(props, m)}
      right={renderRightRail(props, m)}
    />
  );
}

export function renderMailModals(props: MailEditorBodyProps, m: MailEditorModel): ReactNode {
  const { uploadTemplateId, takenKeys } = m;
  if (uploadTemplateId === null) return false; // skip: only tenant rows accept uploads
  const { insert, pdfTemplates } = m.services;
  return (
    <>
      <UploadModal
        open={m.ui.uploadOpen}
        onOpenChange={m.ui.setUploadOpen}
        target={{
          templateId: uploadTemplateId,
          takenKeys,
          onUploaded: (uploaded) => {
            if (uploaded.purpose === "image") insert.insertResource(uploaded.key);
            void props.onRefreshRow();
          },
        }}
      />
      <PdfLinkModal
        open={m.ui.pdfOpen}
        onOpenChange={m.ui.setPdfOpen}
        templates={pdfTemplates.rows}
        variableLabels={m.vocabulary.labels}
        templateId={uploadTemplateId}
        takenKeys={takenKeys}
        onLinked={() => void props.onRefreshRow()}
      />
    </>
  );
}
