// @runtime client
import {
  DocumentContentEditor,
  MAIL_DOCUMENT_BLOCKS,
  PDF_DOCUMENT_BLOCKS,
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
import { ModeSwitch, StatusBadge, TextareaField } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useDeferredValue, useState } from "react";
import { composeLayoutHtml } from "./compose-layout.js";
import {
  AppearanceRail,
  BrandingRail,
  MjmlPreviewRail,
  PlaceholderRail,
  UsedByRail,
} from "./layout-rails.js";
import type {
  LayoutKind,
  LayoutSourceView,
  LayoutValidation,
  TenantOverrideCounts,
  UpsertResponse,
  ValidationIssue,
} from "./layout-types.js";
import { layoutUsers } from "./layout-users.js";
import { OriginBar } from "./origin-bar.js";
import type { OverviewRowView } from "./overview-row.js";
import { asRowStatus, statusLabel, statusTone } from "./status-label.js";

type EditorTab = "draft" | "mjml";
type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

const REGION_EDITOR_IDS = {
  header: "document-designer-region-header",
  signature: "document-designer-region-signature",
  footer: "document-designer-region-footer",
} as const;

function RegionLabel({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

function PaperRegion({
  label,
  testId,
  children,
}: {
  readonly label: string;
  readonly testId: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1.5 px-8 py-3" data-testid={testId}>
      <RegionLabel>{label}</RegionLabel>
      {children}
    </div>
  );
}

function issueText(t: Translate, issue: ValidationIssue): string {
  const translated = t(issue.i18nKey, issue.params);
  return translated === issue.i18nKey ? issue.code : translated;
}

function FooterMessage({
  blockingIssue,
  checked,
  userCount,
  isMail,
}: {
  readonly blockingIssue: ValidationIssue | undefined;
  readonly checked: boolean;
  readonly userCount: number;
  readonly isMail: boolean;
}): ReactNode {
  const t = useTranslation();
  if (!checked) {
    return (
      <span className="text-sm text-muted-foreground">
        {t("documentDesigner.editor.footer.checking")}
      </span>
    );
  }
  if (blockingIssue !== undefined) {
    return (
      <span className="text-sm text-status-bad" data-testid="document-designer-footer-issue">
        {issueText(t, blockingIssue)}
      </span>
    );
  }
  return (
    <span className="text-sm text-status-ok" data-testid="document-designer-footer-ok">
      {t(
        isMail ? "documentDesigner.editor.footer.okMail" : "documentDesigner.editor.footer.okPdf",
        {
          count: userCount,
        },
      )}
    </span>
  );
}

export function LayoutEditorBody({
  kind,
  slug,
  isSystemAdmin,
  source,
  overviewRows,
  overrides,
  onKindChange,
  onReload,
  onBack,
}: {
  readonly kind: LayoutKind;
  readonly slug: string;
  readonly isSystemAdmin: boolean;
  readonly source: LayoutSourceView;
  readonly overviewRows: readonly OverviewRowView[];
  readonly overrides: TenantOverrideCounts | null;
  readonly onKindChange: (kind: LayoutKind) => void;
  readonly onReload: () => Promise<void>;
  readonly onBack: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Banner, Button, Dialog, Heading, Link, Text } = usePrimitives();
  const isMail = kind === "mail-layout";
  const showMjmlTab = isSystemAdmin && source.mjmlSource !== null;

  const [tab, setTab] = useState<EditorTab>(
    showMjmlTab && source.effectiveFormat === "mjml" ? "mjml" : "draft",
  );
  const [header, setHeader] = useState(source.regions.header);
  const [signature, setSignature] = useState(source.regions.signature);
  const [footer, setFooter] = useState(source.regions.footer);
  const [mjml, setMjml] = useState(source.mjmlSource ?? "");
  const [pendingKind, setPendingKind] = useState<LayoutKind | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const upsertTenant = useMutation<UpsertResponse>(TemplateResolverHandlers.upsertTenant);
  const upsertSystem = useMutation<UpsertResponse>(TemplateResolverHandlers.upsertSystem);
  const publishSystem = useMutation(TemplateResolverHandlers.publishSystem);

  const mjmlMode = tab === "mjml";
  const htmlDirty =
    header !== source.regions.header ||
    signature !== source.regions.signature ||
    footer !== source.regions.footer;
  const dirty = mjmlMode ? mjml !== (source.mjmlSource ?? "") : htmlDirty;

  const content = mjmlMode
    ? mjml
    : composeLayoutHtml({ header, signature: isMail ? signature : "", footer });
  const deferredContent = useDeferredValue(content);
  const validation = useQuery<LayoutValidation>(TemplateResolverQueries.validate, {
    slug,
    kind,
    contentFormat: mjmlMode ? "mjml" : "html",
    content: deferredContent,
    locale: source.locale,
    scope: isSystemAdmin ? "system" : "tenant",
  });
  const checked = validation.data;

  const shownRow = isSystemAdmin ? source.system : (source.tenant ?? source.system);
  const userCount = layoutUsers(overviewRows, kind, slug).length;
  const placeholders = checked?.systemPlaceholders ?? [];

  const requestKind = (next: LayoutKind): void => {
    if (next === kind) return;
    if (dirty) setPendingKind(next);
    else onKindChange(next);
  };

  const save = async (publish: boolean): Promise<void> => {
    setSaveError(null);
    const base = {
      slug,
      kind,
      locale: source.locale,
      content,
      contentFormat: mjmlMode ? "mjml" : "html",
      meta: {},
    };
    const saved = isSystemAdmin
      ? await upsertSystem.mutate(base)
      : await upsertTenant.mutate({ ...base, status: publish ? "active" : "draft" });
    if (!saved.isSuccess) {
      setSaveError(dispatcherErrorText(saved.error, t));
      return;
    }
    if (isSystemAdmin && publish) {
      const published = await publishSystem.mutate({ id: saved.data.id });
      if (!published.isSuccess) {
        setSaveError(dispatcherErrorText(published.error, t));
        return;
      }
    }
    await onReload();
  };

  const busy = upsertTenant.pending || upsertSystem.pending || publishSystem.pending;
  const shownStatus = shownRow === null ? null : asRowStatus(shownRow.status);
  const canSave = dirty && checked?.canSave === true && !busy;
  const canPublish = checked?.canPublish === true && (dirty || shownStatus === "draft") && !busy;
  const blockingIssue =
    checked === null ? undefined : [...checked.issues, ...checked.publishIssues][0];

  const backLink = (
    <Link href="#" onPress={onBack} testId="document-designer-back">
      {t("documentDesigner.editor.crumb")}
    </Link>
  );

  return (
    <div className="flex flex-col gap-4 p-6" data-testid="document-designer-layout-editor">
      <div className="flex flex-wrap items-center gap-3">
        {backLink}
        <Text variant="muted">›</Text>
        <Heading variant="page" testId="document-designer-editor-title">
          {t(isMail ? "documentDesigner.editor.title.mail" : "documentDesigner.editor.title.pdf")}
        </Heading>
        {shownRow !== null && shownStatus !== null && (
          <StatusBadge tone={statusTone(shownStatus)} testId="document-designer-editor-status">
            {statusLabel(t, shownStatus, shownRow.version)}
          </StatusBadge>
        )}
        <StatusBadge
          tone={source.tenant !== null ? "accent" : "muted"}
          testId="document-designer-editor-origin"
        >
          {t(
            source.tenant !== null
              ? "documentDesigner.source.tenant"
              : "documentDesigner.source.system",
          )}
        </StatusBadge>
        <div className="grow" />
        <ModeSwitch<LayoutKind>
          value={kind}
          onChange={requestKind}
          ariaLabel={t("documentDesigner.editor.kindSwitch")}
          testId="document-designer-kind-switch"
          options={[
            { value: "mail-layout", label: t("documentDesigner.editor.kind.mail") },
            { value: "pdf-layout", label: t("documentDesigner.editor.kind.pdf") },
          ]}
        />
      </div>

      <OriginBar
        isSystemAdmin={isSystemAdmin}
        source={source}
        kind={kind}
        userCount={userCount}
        overrides={overrides}
        onReset={() => void onReload()}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-4">
          <BrandingRail />
          <PlaceholderRail validation={checked} />
        </div>

        <div className="flex flex-col gap-3">
          {showMjmlTab && (
            <div className="flex justify-end">
              <ModeSwitch<EditorTab>
                value={tab}
                onChange={setTab}
                ariaLabel={t("documentDesigner.editor.tabSwitch")}
                testId="layout-mjml-tab"
                options={[
                  { value: "draft", label: t("documentDesigner.editor.tab.draft") },
                  { value: "mjml", label: t("documentDesigner.editor.tab.mjml") },
                ]}
              />
            </div>
          )}
          {mjmlMode ? (
            <TextareaField
              id="document-designer-mjml-source"
              name="mjml"
              label={t("documentDesigner.editor.mjml.label")}
              value={mjml}
              onChange={setMjml}
              rows={24}
              testId="document-designer-mjml-source"
            />
          ) : (
            <>
              {source.effectiveFormat === "mjml" && (
                <Banner variant="info" testId="document-designer-mjml-notice">
                  {t(
                    isSystemAdmin
                      ? "documentDesigner.editor.mjmlNotice.platform"
                      : "documentDesigner.editor.mjmlNotice.tenant",
                  )}
                </Banner>
              )}
              <div
                className={
                  isMail
                    ? "mx-auto w-[600px] max-w-full divide-y rounded-md border bg-card py-2"
                    : "mx-auto min-h-[842px] w-[595px] max-w-full divide-y rounded-md border bg-card py-2"
                }
                data-testid="document-designer-paper"
              >
                <PaperRegion
                  label={t("documentDesigner.editor.region.header")}
                  testId="document-designer-region-header"
                >
                  <DocumentContentEditor
                    id={REGION_EDITOR_IDS.header}
                    value={header}
                    onChange={setHeader}
                    variables={placeholders}
                    readOnly={false}
                    blocks={isMail ? MAIL_DOCUMENT_BLOCKS : PDF_DOCUMENT_BLOCKS}
                  />
                </PaperRegion>
                <PaperRegion
                  label={t("documentDesigner.editor.region.content")}
                  testId="document-designer-region-content"
                >
                  <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    {t(
                      isMail
                        ? "documentDesigner.editor.slot.mail"
                        : "documentDesigner.editor.slot.pdf",
                    )}
                  </div>
                </PaperRegion>
                {isMail && (
                  <PaperRegion
                    label={t("documentDesigner.editor.region.signature")}
                    testId="document-designer-region-signature"
                  >
                    <DocumentContentEditor
                      id={REGION_EDITOR_IDS.signature}
                      value={signature}
                      onChange={setSignature}
                      variables={placeholders}
                      readOnly={false}
                      blocks={MAIL_DOCUMENT_BLOCKS}
                    />
                  </PaperRegion>
                )}
                <PaperRegion
                  label={t("documentDesigner.editor.region.footer")}
                  testId="document-designer-region-footer"
                >
                  <DocumentContentEditor
                    id={REGION_EDITOR_IDS.footer}
                    value={footer}
                    onChange={setFooter}
                    variables={placeholders}
                    readOnly={false}
                    blocks={isMail ? MAIL_DOCUMENT_BLOCKS : PDF_DOCUMENT_BLOCKS}
                  />
                </PaperRegion>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <AppearanceRail kind={kind} />
          {showMjmlTab && source.mjmlSource !== null && (
            <MjmlPreviewRail mjmlSource={source.mjmlSource} />
          )}
          <UsedByRail layoutSlug={slug} kind={kind} rows={overviewRows} />
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-3 border-t pt-3"
        data-testid="document-designer-footer-bar"
      >
        {saveError !== null ? (
          <Banner variant="error" testId="document-designer-save-error">
            {saveError}
          </Banner>
        ) : (
          <FooterMessage
            blockingIssue={blockingIssue}
            checked={checked !== null}
            userCount={userCount}
            isMail={isMail}
          />
        )}
        <div className="grow" />
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => {
              setHeader(source.regions.header);
              setSignature(source.regions.signature);
              setFooter(source.regions.footer);
              setMjml(source.mjmlSource ?? "");
              setSaveError(null);
            }}
            testId="document-designer-discard"
          >
            {t("documentDesigner.editor.discard")}
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={!canSave}
          loading={busy}
          onClick={() => save(false)}
          testId="document-designer-save"
        >
          {t("documentDesigner.editor.save")}
        </Button>
        <Button
          disabled={!canPublish}
          onClick={() => save(true)}
          testId="document-designer-publish"
        >
          {t("documentDesigner.editor.publish")}
        </Button>
      </div>

      <Dialog
        open={pendingKind !== null}
        onOpenChange={(open) => {
          if (!open) setPendingKind(null);
        }}
        title={t("documentDesigner.editor.dirtySwitch.title")}
        description={t("documentDesigner.editor.dirtySwitch.description")}
        confirmLabel={t("documentDesigner.editor.dirtySwitch.confirm")}
        variant="danger"
        onConfirm={() => {
          if (pendingKind !== null) onKindChange(pendingKind);
        }}
      />
    </div>
  );
}
