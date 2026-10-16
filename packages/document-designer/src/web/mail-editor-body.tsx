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
import {
  EditorHeader,
  EditorLocaleSwitch,
  type EditorMode,
  EditorModeSwitch,
  originOf,
} from "./editor-header.js";
import { EditorBody, EditorFooter, EditorFrame } from "./editor-shell.js";
import { fileUrl } from "./file-name.js";
import { type ConfirmDialog, type LeaveTarget, MailConfirmDialogs } from "./mail-dialogs.js";
import {
  buildMeta,
  isDraftDirty,
  loadedMailOf,
  parseJsonRecord,
  parseLinkedResources,
  systemLabelMap,
  variableLabelMap,
} from "./mail-draft.js";
import { MailEditCenter } from "./mail-edit-center.js";
import { footerMessage, metaFieldMessages } from "./mail-footer.js";
import { PlaceholderSection, ResourceSection, SystemPlaceholderSection } from "./mail-left-rail.js";
import { MissingLocaleCanvas } from "./mail-missing-locale.js";
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
import { useOwnAddress } from "./use-own-address.js";
import { useSettledValue } from "./use-settled-value.js";
import { useTestMail } from "./use-test-mail.js";

// The editor replaces this token with the decoded image size once the preview image loaded.
const SIZE_TOKEN = "{size}";

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
  const [draft, setDraft] = useState(baseline);
  const [settled, settle] = useSettledValue(baseline);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<ConfirmDialog>({ kind: "none" });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [prefixSubject, setPrefixSubject] = useState(true);

  const insert = useInsertTargets();
  const persistence = useMailPersistence({
    slug,
    locale,
    title,
    isSystemAdmin,
    row,
  });
  const testMail = useTestMail();
  const own = useOwnAddress();
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
    meta: buildMeta(settled),
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
    setDraft(baseline);
    settle(baseline);
    setEditorEpoch((epoch) => epoch + 1);
    persistence.clearError();
  };

  const dirty = isDraftDirty(draft, baseline);
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

  const perform = (target: LeaveTarget): void => props.onLocaleChange(target.locale);
  const leave = (target: LeaveTarget): void => {
    if (target.locale === locale) return;
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
                caption: t("documentDesigner.mail.resource.caption", {
                  key: resource.key,
                  size: SIZE_TOKEN,
                }),
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
      meta: buildMeta(draft),
      variableSchema,
      includeAttachments,
      prefixSubject,
    });
  };

  // Nothing is written yet in a missing language, so no placeholder may read as missing.
  const railValidation =
    locked && validation != null ? { ...validation, missingRequired: [] } : (validation ?? null);
  const names = placeholderNames(validation ?? null);
  const vocabulary = {
    names,
    labels: {
      ...systemLabelMap(t, validation?.systemPlaceholders ?? []),
      ...variableLabelMap(validation?.variables ?? {}),
    },
    system: validation?.systemPlaceholders ?? [],
  };
  const attachments = resources.filter((resource) => resource.kind !== "image");
  const footer =
    locked || validation === undefined || validation === null
      ? null
      : footerMessage(t, validation, mode === "preview");

  const fieldErrors = locked ? {} : metaFieldMessages(t, validation ?? null);
  const publish = (): void => void saveAndReload(true);
  const controls = (
    <EditorLocaleSwitch
      testIdPrefix="mail"
      locales={props.locales}
      locale={locale}
      onLocale={(next) => leave({ kind: "locale", locale: next })}
    />
  );
  const origin =
    row === null ? null : originOf(row.scope !== "tenant", props.systemVersion !== null);
  return (
    <EditorFrame testId="document-designer-mail-editor">
      <EditorHeader
        title={title}
        stored={row === null ? null : { status: row.status, version: row.version }}
        actions={{ busy, canSave, canPublish, onSave: requestSave, onPublish: publish }}
      >
        <EditorModeSwitch testIdPrefix="mail" mode={mode} onMode={setMode} />
      </EditorHeader>
      {mode === "edit" && (
        <MailOriginBar
          row={row}
          systemVersion={props.systemVersion}
          locale={locale}
          isSystemAdmin={isSystemAdmin}
          creating={creating}
          controls={controls}
          onReload={() => void onReload()}
        />
      )}
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
      {mode === "edit" ? (
        <EditorBody
          left={
            <>
              <PlaceholderSection validation={railValidation} onInsert={insert.insertPlaceholder} />
              <SystemPlaceholderSection
                validation={railValidation}
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
            </>
          }
          center={
            locked ? (
              <MissingLocaleCanvas
                slug={slug}
                locale={locale}
                fallbackLocale={props.fallbackLocale}
                copyScope={isSystemAdmin ? "system" : "tenant"}
                onCreateBlank={() => setCreating(true)}
                onCopied={() => void onReload()}
              />
            ) : (
              <MailEditCenter
                key={editorEpoch}
                draft={draft}
                vocabulary={vocabulary}
                resourcePreviews={resourcePreviews}
                insert={insert}
                readOnly={false}
                fieldErrors={fieldErrors}
                onChange={update}
              />
            )
          }
          right={
            <>
              <PropertiesSection draft={draft} layouts={layouts.rows} onChange={update} />
              <AttachmentSection
                attachments={attachments}
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
            </>
          }
        />
      ) : (
        <MailPreviewMode
          payload={{
            slug,
            kind: "mail",
            locale,
            content: settled.body,
            meta: buildMeta(settled),
            variableSchema,
          }}
          validation={validation ?? null}
          slug={slug}
          locale={locale}
          fromName={settled.senderName}
          own={own}
          origin={origin}
          controls={controls}
          testMail={{
            pending: testMail.pending,
            onSend: sendTestMail,
            includeAttachments,
            onIncludeAttachments: setIncludeAttachments,
            prefixSubject,
            onPrefixSubject: setPrefixSubject,
          }}
        />
      )}
      {!locked && (
        <EditorFooter
          testIdPrefix="mail-editor"
          message={footer}
          saveError={persistence.error}
          modifiedAt={row?.modifiedAt ?? null}
          dirty={dirty}
          busy={busy}
          canSave={canSave}
          canPublish={canPublish}
          onDiscard={() => setDialog({ kind: "discard" })}
          onSave={requestSave}
          onPublish={publish}
        />
      )}
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
    </EditorFrame>
  );
}
