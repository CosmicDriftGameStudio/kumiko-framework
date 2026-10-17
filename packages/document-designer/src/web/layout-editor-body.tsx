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
import { cn, ModeSwitch, TextareaField } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useState } from "react";
import { BRANDING_QUERY_QN } from "../constants.js";
import { composeLayoutHtml } from "./compose-layout.js";
import { EditorHeader } from "./editor-header.js";
import { EditorBody, EditorFooter, EditorFrame, type FooterTone } from "./editor-shell.js";
import { fileUrl } from "./file-name.js";
import {
  appearanceOf,
  isHexColor,
  type LayoutAppearance,
  type LayoutWidth,
  metaToSave,
} from "./layout-meta.js";
import {
  AppearanceRail,
  BrandingRail,
  MjmlSourceRail,
  PlaceholderRail,
  RendererRail,
  UsedByRail,
} from "./layout-rails.js";
import type {
  BrandingView,
  LayoutKind,
  LayoutSourceView,
  LayoutValidation,
  TenantOverrideCounts,
  UpsertResponse,
  ValidationIssue,
} from "./layout-types.js";
import { systemLabelMap } from "./mail-draft.js";
import { OriginBar } from "./origin-bar.js";
import type { OverviewRowView } from "./overview-row.js";
import { asRowStatus } from "./status-label.js";
import { useDebouncedValue } from "./use-debounced-value.js";

// Server-side validation compiles the whole layout (mjml), so wait for a pause in typing.
const VALIDATE_DEBOUNCE_MS = 400;

type EditorTab = "draft" | "mjml";
type Region = "header" | "signature" | "footer";
type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

const REGION_EDITOR_IDS: Readonly<Record<Region, string>> = {
  header: "document-designer-region-header",
  signature: "document-designer-region-signature",
  footer: "document-designer-region-footer",
};

const PAPER_WIDTH_CLASS: Readonly<Record<LayoutWidth, string>> = {
  560: "max-w-[560px]",
  600: "max-w-[600px]",
  640: "max-w-[640px]",
};

function issueText(t: Translate, issue: ValidationIssue): string {
  const translated = t(issue.i18nKey, issue.params);
  return translated === issue.i18nKey ? issue.code : translated;
}

function sameAppearance(a: LayoutAppearance, b: LayoutAppearance): boolean {
  return (
    a.width === b.width &&
    a.font === b.font &&
    a.outerBackground === b.outerBackground &&
    a.accentLine === b.accentLine &&
    a.buttonStyle === b.buttonStyle
  );
}

// A dashed, labelled area of the paper; the focused one owns the shared toolbar.
function PaperRegion({
  label,
  testId,
  children,
  onFocus,
}: {
  readonly label: string;
  readonly testId: string;
  readonly children: ReactNode;
  readonly onFocus?: () => void;
}): ReactNode {
  return (
    <div
      className="relative rounded-sm border border-dashed border-input p-3"
      data-testid={testId}
      onFocusCapture={onFocus}
    >
      <span className="absolute -top-2.5 left-2.5 bg-card px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

export function LayoutEditorBody({
  kind,
  slug,
  isSystemAdmin,
  source,
  overviewRows,
  usedByCount,
  overrides,
  onKindChange,
  onReload,
}: {
  readonly kind: LayoutKind;
  readonly slug: string;
  readonly isSystemAdmin: boolean;
  readonly source: LayoutSourceView;
  readonly overviewRows: readonly OverviewRowView[];
  readonly usedByCount: number;
  readonly overrides: TenantOverrideCounts | null;
  readonly onKindChange: (kind: LayoutKind) => void;
  readonly onReload: () => Promise<void>;
}): ReactNode {
  const t = useTranslation();
  const { Banner, Dialog } = usePrimitives();
  const isMail = kind === "mail-layout";
  const showMjmlTab = isSystemAdmin && source.mjmlSource !== null;

  const [tab, setTab] = useState<EditorTab>(
    showMjmlTab && source.effectiveFormat === "mjml" ? "mjml" : "draft",
  );
  const [header, setHeader] = useState(source.regions.header);
  const [signature, setSignature] = useState(source.regions.signature);
  const [footer, setFooter] = useState(source.regions.footer);
  const [mjml, setMjml] = useState(source.mjmlSource ?? "");
  const storedAppearance = appearanceOf(source.meta);
  const [appearance, setAppearance] = useState(storedAppearance);
  const [activeRegion, setActiveRegion] = useState<Region>("header");
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const [pendingKind, setPendingKind] = useState<LayoutKind | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const upsertTenant = useMutation<UpsertResponse>(TemplateResolverHandlers.upsertTenant);
  const upsertSystem = useMutation<UpsertResponse>(TemplateResolverHandlers.upsertSystem);
  const publishSystem = useMutation(TemplateResolverHandlers.publishSystem);
  const branding = useQuery<BrandingView>(BRANDING_QUERY_QN, {});

  const mjmlMode = tab === "mjml";
  // An mjml layout brings its own look; the appearance fields only drive structured (html) layouts.
  const appearanceFromMjml = source.effectiveFormat === "mjml" || mjmlMode;
  const appearanceEditable = isMail && !appearanceFromMjml;
  const appearanceDirty = appearanceEditable && !sameAppearance(appearance, storedAppearance);
  const appearanceValid = !appearanceEditable || isHexColor(appearance.outerBackground);
  const htmlDirty =
    header !== source.regions.header ||
    signature !== source.regions.signature ||
    footer !== source.regions.footer ||
    appearanceDirty;
  const dirty = mjmlMode ? mjml !== (source.mjmlSource ?? "") : htmlDirty;

  const content = mjmlMode
    ? mjml
    : composeLayoutHtml({ header, signature: isMail ? signature : "", footer });
  const debouncedContent = useDebouncedValue(content, VALIDATE_DEBOUNCE_MS);
  const validation = useQuery<LayoutValidation>(TemplateResolverQueries.validate, {
    slug,
    kind,
    contentFormat: mjmlMode ? "mjml" : "html",
    content: debouncedContent,
    locale: source.locale,
    scope: isSystemAdmin ? "system" : "tenant",
  });
  const checked = validation.data;

  const shownRow = isSystemAdmin ? source.system : (source.tenant ?? source.system);
  const userCount = usedByCount;
  const placeholders = checked?.systemPlaceholders ?? [];
  const placeholderLabels = systemLabelMap(t, placeholders);

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
      meta: appearanceEditable ? metaToSave(appearance, source.meta) : isMail ? source.meta : {},
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
  const canSave = dirty && checked?.canSave === true && appearanceValid && !busy;
  const canPublish =
    checked?.canPublish === true && appearanceValid && (dirty || shownStatus === "draft") && !busy;
  const blockingIssue =
    checked === null ? undefined : [...checked.issues, ...checked.publishIssues][0];
  const footerMessage: { readonly tone: FooterTone; readonly text: string } | null =
    checked === null
      ? null
      : !appearanceValid
        ? { tone: "bad", text: t("documentDesigner.appearance.backgroundInvalid") }
        : blockingIssue !== undefined
          ? { tone: "bad", text: issueText(t, blockingIssue) }
          : {
              tone: "ok",
              text: t(
                isMail
                  ? "documentDesigner.editor.footer.okMail"
                  : "documentDesigner.editor.footer.okPdf",
                { count: userCount },
              ),
            };

  const accentColor = branding.data?.accentColor ?? "";
  const showAccentLine =
    isMail && appearanceEditable && appearance.accentLine === "branding" && isHexColor(accentColor);
  const blocks = isMail ? MAIL_DOCUMENT_BLOCKS : PDF_DOCUMENT_BLOCKS;

  // The layout's "logo" resource is the branding logo, so the editor shows it instead of a chip.
  const logoFile = branding.data?.logoFile ?? "";
  const resourcePreviews =
    logoFile === ""
      ? undefined
      : {
          logo: {
            src: fileUrl(logoFile),
            caption: isMail ? t("documentDesigner.editor.logoCaption") : "",
          },
        };

  const regionEditor = (region: Region, value: string, onChange: (next: string) => void) => (
    <DocumentContentEditor
      id={REGION_EDITOR_IDS[region]}
      value={value}
      onChange={onChange}
      variables={placeholders}
      variableLabels={placeholderLabels}
      systemVariables={placeholders}
      readOnly={false}
      blocks={blocks}
      {...(resourcePreviews && { resourcePreviews })}
      chrome="canvas"
      toolbarHost={activeRegion === region ? toolbarHost : null}
    />
  );

  return (
    <EditorFrame testId="document-designer-layout-editor">
      <EditorHeader
        title={t(
          kind === "mail-layout"
            ? "documentDesigner.editor.title.mail"
            : "documentDesigner.editor.title.pdf",
        )}
        stored={shownRow}
        actions={{
          busy,
          canSave,
          canPublish,
          onSave: () => void save(false),
          onPublish: () => void save(true),
        }}
      >
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
      </EditorHeader>
      <OriginBar
        isSystemAdmin={isSystemAdmin}
        source={source}
        kind={kind}
        userCount={userCount}
        overrides={overrides}
        onReset={() => void onReload()}
        onResetError={setSaveError}
      />
      <EditorBody
        left={
          <>
            <BrandingRail
              data={branding.data}
              unavailable={branding.error !== null || (branding.data === null && !branding.loading)}
            />
            <PlaceholderRail validation={checked} />
            <RendererRail kind={kind} />
          </>
        }
        center={
          <>
            <div className="flex items-center border-b bg-background">
              <div ref={setToolbarHost} className="min-w-0 flex-1" />
              {showMjmlTab && (
                <div className="shrink-0 px-3 py-1">
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
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
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
                <div className="flex flex-col gap-3">
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
                    className={cn(
                      "mx-auto flex w-full flex-col gap-5 bg-card px-8 py-6 shadow-md",
                      isMail ? PAPER_WIDTH_CLASS[appearance.width] : "min-h-[842px] max-w-[595px]",
                      showAccentLine && "border-t-4 border-t-(--layout-accent)",
                    )}
                    ref={(element) => element?.style.setProperty("--layout-accent", accentColor)}
                    data-testid="document-designer-paper"
                  >
                    <PaperRegion
                      label={t("documentDesigner.editor.region.header")}
                      testId="document-designer-region-header"
                      onFocus={() => setActiveRegion("header")}
                    >
                      {regionEditor("header", header, setHeader)}
                    </PaperRegion>
                    <div
                      className="rounded-sm border-2 border-dashed border-primary bg-primary/10 px-3 py-9 text-center font-medium text-primary"
                      data-testid="document-designer-region-content"
                    >
                      ⊞ {t("documentDesigner.editor.region.content")}
                      <small className="mt-1 block text-xs font-normal opacity-85">
                        {t(
                          isMail
                            ? "documentDesigner.editor.slot.mail"
                            : "documentDesigner.editor.slot.pdf",
                        )}
                      </small>
                    </div>
                    {isMail && (
                      <PaperRegion
                        label={t("documentDesigner.editor.region.signature")}
                        testId="document-designer-region-signature"
                        onFocus={() => setActiveRegion("signature")}
                      >
                        {regionEditor("signature", signature, setSignature)}
                      </PaperRegion>
                    )}
                    <div className={cn(isMail && "-mx-8 -mb-6 bg-muted px-8 py-4")}>
                      <PaperRegion
                        label={t("documentDesigner.editor.region.footer")}
                        testId="document-designer-region-footer"
                        onFocus={() => setActiveRegion("footer")}
                      >
                        {regionEditor("footer", footer, setFooter)}
                      </PaperRegion>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        }
        right={
          <>
            {isMail && (
              <AppearanceRail
                appearance={appearance}
                onChange={setAppearance}
                fromMjml={appearanceFromMjml}
              />
            )}
            {isMail && !mjmlMode && <MjmlSourceRail mjmlSource={source.mjmlSource} />}
            <UsedByRail layoutSlug={slug} kind={kind} rows={overviewRows} />
          </>
        }
      />
      <EditorFooter
        testIdPrefix="document-designer"
        message={footerMessage}
        saveError={saveError}
        modifiedAt={null}
        dirty={dirty}
        busy={busy}
        canSave={canSave}
        canPublish={canPublish}
        onDiscard={() => {
          setHeader(source.regions.header);
          setSignature(source.regions.signature);
          setFooter(source.regions.footer);
          setMjml(source.mjmlSource ?? "");
          setAppearance(storedAppearance);
          setSaveError(null);
        }}
        onSave={() => void save(false)}
        onPublish={() => void save(true)}
      />
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
    </EditorFrame>
  );
}
