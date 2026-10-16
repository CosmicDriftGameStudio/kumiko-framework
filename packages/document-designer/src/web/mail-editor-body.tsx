// @runtime client
import {
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  dispatcherErrorText,
  useMutation,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { fileUrl } from "./file-name.js";
import { type ConfirmDialog, type LeaveTarget, MailConfirmDialogs } from "./mail-dialogs.js";
import {
  buildMeta,
  isDraftDirty,
  loadedMailOf,
  parseJsonRecord,
  parseLinkedResources,
  variableLabelMap,
} from "./mail-draft.js";
import { MailEditCenter } from "./mail-edit-center.js";
import { MailFooter } from "./mail-footer.js";
import { type EditorMode, MailHeader } from "./mail-header.js";
import { PlaceholderSection, ResourceSection, SystemPlaceholderSection } from "./mail-left-rail.js";
import { MailOriginBar } from "./mail-origin-bar.js";
import { PdfLinkModal } from "./mail-pdf-link-modal.js";
import { MailPreviewMode } from "./mail-preview.js";
import { AttachmentSection, PropertiesSection, UsageSection } from "./mail-right-rail.js";
import type { MailDraft, MailValidation, TemplateRowView } from "./mail-types.js";
import { UploadModal } from "./mail-upload-modal.js";
import { VersionsSection } from "./mail-versions.js";
import { useInsertTargets } from "./use-insert-targets.js";
import { useMailPersistence } from "./use-mail-persistence.js";
import { useOverviewRows } from "./use-overview-rows.js";
import { useSettledValue } from "./use-settled-value.js";
import { useTestMail } from "./use-test-mail.js";

export type MailEditorBodyProps = {
  readonly slug: string;
  readonly locale: string;
  readonly locales: readonly string[];
  readonly title: string;
  readonly isSystemAdmin: boolean;
  readonly row: TemplateRowView | null;
  readonly systemVersion: number | null;
  readonly fallbackLocale: string | null;
  readonly onLocaleChange: (locale: string) => void;
  readonly onReload: () => Promise<void>;
  readonly onRefreshRow: () => Promise<void>;
  readonly onBack: () => void;
};

type RailsProps = {
  readonly validation: MailValidation | null;
  readonly row: TemplateRowView | null;
  readonly slug: string;
  readonly draft: MailDraft;
  readonly onChange: (patch: Partial<MailDraft>) => void;
};

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function placeholderNames(validation: MailValidation | null): string[] {
  if (validation === null) return [];
  const own = Object.entries(validation.variables).flatMap(([name, variable]) => [
    name,
    ...Object.keys(variable.item ?? {}).map((item) => `${name}.${item}`),
  ]);
  return sortedUnique([...own, ...validation.systemPlaceholders]);
}

export function MailEditorBody(props: MailEditorBodyProps): ReactNode {
  const { slug, locale, title, isSystemAdmin, row, onReload, onRefreshRow } = props;
  const t = useTranslation();
  const { Banner } = usePrimitives();
  const [baseline] = useState(() => loadedMailOf(row));
  const [draft, setDraft] = useState(baseline.draft);
  const [settled, settle] = useSettledValue(baseline.draft);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<ConfirmDialog>({ kind: "none" });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);

  const insert = useInsertTargets();
  const persistence = useMailPersistence({
    slug,
    locale,
    title,
    isSystemAdmin,
    row,
    sender: baseline.sender,
  });
  const testMail = useTestMail();
  const resourceRemove = useMutation(TemplateResolverHandlers.resourceRemove);
  const layouts = useOverviewRows("mail-layout");
  const pdfTemplates = useOverviewRows("document-pdf");

  const locked = row === null && !creating;
  const variableSchema = parseJsonRecord(row?.variableSchema);
  const validation = useQuery<MailValidation>(TemplateResolverQueries.validate, {
    slug,
    kind: "mail",
    contentFormat: "html",
    content: settled.body,
    meta: buildMeta(settled, baseline.sender),
    variableSchema,
    locale,
    scope: isSystemAdmin ? "system" : "tenant",
  }).data;

  const update = (patch: Partial<MailDraft>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    settle(next);
  };
  const reset = (): void => {
    setDraft(baseline.draft);
    settle(baseline.draft);
    setEditorEpoch((epoch) => epoch + 1);
    persistence.clearError();
  };

  const dirty = isDraftDirty(draft, baseline.draft);
  const isActiveTenantRow = row?.scope === "tenant" && row.status === "active";
  const busy = persistence.busy;
  const canSave = !locked && !busy && validation?.canSave === true && (dirty || creating);
  const canPublish =
    !locked &&
    !busy &&
    validation?.canPublish === true &&
    (dirty || creating || row?.status !== "active");

  const persist = async (publish: boolean): Promise<boolean> => persistence.save(draft, publish);
  const saveAndReload = async (publish: boolean): Promise<void> => {
    if (await persist(publish)) await onReload();
  };
  const requestSave = (): void => {
    if (isActiveTenantRow) setDialog({ kind: "activeSave" });
    else void saveAndReload(false);
  };

  const perform = (target: LeaveTarget): void => {
    if (target.kind === "locale") props.onLocaleChange(target.locale);
    else props.onBack();
  };
  const leave = (target: LeaveTarget): void => {
    if (target.kind === "locale" && target.locale === locale) return;
    if (dirty) setDialog({ kind: "leave", target });
    else perform(target);
  };

  const resources = parseLinkedResources(row?.linkedResources);
  const pdfTitles = new Map(pdfTemplates.rows.map((template) => [template.slug, template.title]));
  const resourcePreviews = Object.fromEntries(
    resources.flatMap((resource) =>
      resource.kind === "image"
        ? [
            [
              resource.key,
              {
                src: fileUrl(resource.fileRefId),
                caption: t("documentDesigner.mail.resource.caption", { key: resource.key }),
              },
            ],
          ]
        : [],
    ),
  );
  const uploadTemplateId = row?.scope === "tenant" ? row.id : null;
  const takenKeys = resources.map((resource) => resource.key);

  const removeResource = async (key: string): Promise<void> => {
    if (uploadTemplateId === null) return;
    setResourceError(null);
    const result = await resourceRemove.mutate({ templateId: uploadTemplateId, key });
    if (result.isSuccess) await onRefreshRow();
    else setResourceError(dispatcherErrorText(result.error, t));
  };

  const sendTestMail = (): void => {
    void testMail.send({
      slug,
      locale,
      content: draft.body,
      meta: buildMeta(draft, baseline.sender),
      variableSchema,
    });
  };

  const names = placeholderNames(validation ?? null);
  const vocabulary = {
    names,
    labels: variableLabelMap(validation?.variables ?? {}),
    system: validation?.systemPlaceholders ?? [],
  };
  const rails: RailsProps = { validation: validation ?? null, row, slug, draft, onChange: update };

  return (
    <div className="flex flex-col gap-4 p-6" data-testid="document-designer-mail-editor">
      <MailHeader
        title={title}
        row={row}
        locales={props.locales}
        locale={locale}
        mode={mode}
        testPending={testMail.pending}
        actions={{
          busy,
          canSave,
          canPublish,
          onSave: requestSave,
          onPublish: () => void saveAndReload(true),
        }}
        onBack={() => leave({ kind: "back" })}
        onLocale={(next) => leave({ kind: "locale", locale: next })}
        onMode={setMode}
        onTestMail={sendTestMail}
      />
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
      {resourceError !== null && (
        <Banner variant="error" testId="mail-resource-error">
          {resourceError}
        </Banner>
      )}
      <MailOriginBar
        row={row}
        title={title}
        systemVersion={props.systemVersion}
        slug={slug}
        locale={locale}
        fallbackLocale={props.fallbackLocale}
        isSystemAdmin={isSystemAdmin}
        creating={creating}
        onCreateBlank={() => setCreating(true)}
        onReload={() => void onReload()}
      />
      {mode === "edit" ? (
        <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
          <div className="flex max-h-[70vh] flex-col overflow-y-auto">
            <PlaceholderSection validation={rails.validation} onInsert={insert.insertPlaceholder} />
            <SystemPlaceholderSection
              validation={rails.validation}
              onInsert={insert.insertPlaceholder}
            />
            <ResourceSection
              resources={resources}
              pdfTitles={pdfTitles}
              canUpload={uploadTemplateId !== null}
              onUpload={() => setUploadOpen(true)}
              onInsert={insert.insertResource}
              onRemove={(key) => setDialog({ kind: "remove", key })}
            />
          </div>
          <MailEditCenter
            key={editorEpoch}
            draft={draft}
            vocabulary={vocabulary}
            resourcePreviews={resourcePreviews}
            insert={insert}
            readOnly={locked}
            onChange={update}
          />
          <div className="flex max-h-[70vh] flex-col overflow-y-auto">
            <PropertiesSection draft={draft} layouts={layouts.rows} onChange={update} />
            <AttachmentSection
              attachments={resources.filter((resource) => resource.kind !== "image")}
              pdfTitles={pdfTitles}
              canEdit={uploadTemplateId !== null}
              onAddPdf={() => setPdfOpen(true)}
              onRemove={(key) => setDialog({ kind: "remove", key })}
            />
            <UsageSection slug={slug} />
            <VersionsSection
              rowId={row?.id ?? null}
              currentVersion={row?.version ?? 0}
              currentStatus={row?.status ?? "draft"}
            />
          </div>
        </div>
      ) : (
        <MailPreviewMode
          payload={{
            slug,
            kind: "mail",
            locale,
            content: settled.body,
            meta: buildMeta(settled, baseline.sender),
            variableSchema,
          }}
          validation={validation ?? null}
          slug={slug}
          locale={locale}
          testMail={{ pending: testMail.pending, onSend: sendTestMail }}
        />
      )}
      <MailFooter
        validation={validation ?? null}
        previewMode={mode === "preview"}
        saveError={persistence.error}
        modifiedAt={row?.modifiedAt ?? null}
        dirty={dirty}
        busy={busy}
        canSave={canSave}
        canPublish={canPublish}
        onDiscard={() => setDialog({ kind: "discard" })}
        onSave={requestSave}
        onPublish={() => void saveAndReload(true)}
      />
      {uploadTemplateId !== null && (
        <>
          <UploadModal
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            target={{
              templateId: uploadTemplateId,
              takenKeys,
              onUploaded: (uploaded) => {
                if (uploaded.purpose === "image") insert.insertResource(uploaded.key);
                void onRefreshRow();
              },
            }}
          />
          <PdfLinkModal
            open={pdfOpen}
            onOpenChange={setPdfOpen}
            templates={pdfTemplates.rows}
            variableLabels={vocabulary.labels}
            templateId={uploadTemplateId}
            takenKeys={takenKeys}
            onLinked={() => void onRefreshRow()}
          />
        </>
      )}
      <MailConfirmDialogs
        dialog={dialog}
        onClose={() => setDialog({ kind: "none" })}
        onDiscard={() => {
          reset();
          setDialog({ kind: "none" });
        }}
        onSaveDraft={async () => {
          await saveAndReload(false);
        }}
        onRemove={removeResource}
        onLeaveSave={async (target) => {
          if (await persist(false)) perform(target);
        }}
        onLeaveDiscard={(target) => {
          setDialog({ kind: "none" });
          perform(target);
        }}
      />
    </div>
  );
}
