// @runtime client
import {
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
  useUserRoles,
} from "@cosmicdrift/kumiko-renderer";
import {
  ErrorState,
  LoadingState,
  PdfPreview,
  uploadFileRef,
} from "@cosmicdrift/kumiko-renderer/web";
import { RendererPuppeteerClientQueries } from "@cosmicdrift/kumiko-renderer-puppeteer-client/qualified-names";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { BRANDING_QUERY_QN } from "../constants.ts";
import {
  EditorHeader,
  EditorLocaleSwitch,
  type EditorMode,
  EditorModeSwitch,
  originOf,
} from "./editor-header.tsx";
import { EditorBody, EditorFooter, EditorFrame, EditorInfoBar } from "./editor-shell.tsx";
import { describeError, isAlreadyActive } from "./errors.ts";
import { fileUrl } from "./file-name.ts";
import type { BrandingView } from "./layout-types.ts";
import { systemLabelMap, variableLabelMap } from "./mail-draft.ts";
import { PlaceholderSection, SystemPlaceholderSection } from "./mail-left-rail.tsx";
import type { MailVariable } from "./mail-types.ts";
import { OverridesDrawer } from "./overrides-drawer.tsx";
import { PageCanvas } from "./page-canvas.tsx";
import { pdfFooterMessage } from "./pdf-footer.ts";
import { PdfResourceSection, visibleSystemPlaceholders } from "./pdf-left-rail.tsx";
import { EMPTY_PDF_META, type PdfMetaDraft, parsePdfMeta, serializePdfMeta } from "./pdf-meta.ts";
import { SettingsPanel } from "./settings-panel.tsx";
import { draftBesideActiveSentence } from "./status-label.ts";
import { localesOf, parseJsonObject, pickRow, resolveLocale } from "./template-rows.ts";
import {
  DEFAULT_LAYOUT_SLUG,
  DOCUMENT_PDF_KIND,
  PDF_LAYOUT_KIND,
  type PdfPreviewResult,
  type PreviewResult,
  type PuppeteerStatus,
  type SaveResult,
  type TemplateDetail,
  type TemplateListRow,
  type TemplateScope,
  type TenantOverrides,
  type ValidationResult,
  type VariableInfo,
} from "./types.ts";
import { useInsertTargets } from "./use-insert-targets.ts";
import { useOverviewRows } from "./use-overview-rows.ts";
import { templateTitle } from "./used-by-label.ts";

const SETTLE_MS = 500;
const NO_VARIABLES: Readonly<Record<string, VariableInfo>> = {};

// Only the label of an images variable is needed, for the Images block and its picker.
function imageLabelSource(
  variables: Readonly<Record<string, VariableInfo>>,
): Readonly<Record<string, MailVariable>> {
  const result: Record<string, MailVariable> = {};
  for (const [name, info] of Object.entries(variables)) {
    if (info.type === "images" && info.label !== undefined) {
      result[name] = { type: "text", label: info.label };
    }
  }
  return result;
}

function textVariablesOf(
  variables: Readonly<Record<string, VariableInfo>>,
): Readonly<Record<string, MailVariable>> {
  const result: Record<string, MailVariable> = {};
  for (const [name, info] of Object.entries(variables)) {
    if (info.type === "images") continue;
    const { item, ...rest } = info;
    const columns = Object.entries(item ?? {}).flatMap(([column, def]) =>
      def.type === "images" ? [] : [[column, { ...def, type: def.type }] as const],
    );
    result[name] = {
      ...rest,
      type: info.type,
      ...(item !== undefined && { item: Object.fromEntries(columns) }),
    };
  }
  return result;
}

type Draft = { readonly content: string; readonly meta: PdfMetaDraft };

type EditorState = {
  readonly key: string;
  readonly draft: Draft;
  // The draft the server-side checks run against; trails the draft by SETTLE_MS while typing.
  readonly settled: Draft;
  readonly snapshot: string;
};

type GeneratedPdf = { readonly forSnapshot: string; readonly result: PdfPreviewResult };

// Opening the preview prints the page without a click; a failed print is not retried for the same draft.
function RunOnMount({ run }: { readonly run: () => void }): null {
  useEffect(() => {
    run();
  }, [run]);
  return null;
}

export type PdfTemplateEditorProps = {
  readonly slug: string;
  /** Template locale; defaults to "de", or the first locale the slug has. */
  readonly locale?: string;
  readonly onLocaleChange?: (locale: string) => void;
};

const draftFromDetail = (detail: TemplateDetail): Draft => ({
  content: detail.content,
  meta: parsePdfMeta(detail.meta),
});

const snapshotOf = (draft: Draft): string =>
  JSON.stringify({ content: draft.content, meta: serializePdfMeta(draft.meta) });

export function PdfTemplateEditor({
  slug,
  locale: requestedLocale,
  onLocaleChange,
}: PdfTemplateEditorProps): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const { Button, Banner, Dialog } = usePrimitives();
  const insert = useInsertTargets();
  const overview = useOverviewRows(DOCUMENT_PDF_KIND);
  const roles = useUserRoles();
  const scope: TemplateScope = roles?.includes("SystemAdmin") === true ? "system" : "tenant";

  const rowsQuery = useQuery<readonly TemplateListRow[]>(TemplateResolverQueries.list, {
    kind: DOCUMENT_PDF_KIND,
  });
  const rows = rowsQuery.data ?? [];
  const locales = localesOf(rows, slug);
  const locale = resolveLocale(requestedLocale, locales);
  const row = pickRow(rows, slug, locale, scope);

  const detailQuery = useQuery<TemplateDetail | null>(
    TemplateResolverQueries.findById,
    { id: row?.id ?? "" },
    { enabled: row !== undefined },
  );
  const detail =
    detailQuery.data !== null &&
    detailQuery.data?.slug === slug &&
    detailQuery.data.locale === locale
      ? detailQuery.data
      : null;

  const [state, setState] = useState<EditorState | null>(null);
  if (detail !== null && (state === null || state.key !== detail.id)) {
    const draft = draftFromDetail(detail);
    setState({ key: detail.id, draft, settled: draft, snapshot: snapshotOf(draft) });
  }
  const current = state !== null && detail !== null && state.key === detail.id ? state : null;

  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A pending settle must not fire into an unmounted editor.
  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    [],
  );
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [busy, setBusy] = useState<"save" | "publish" | "pdf" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedPdf | null>(null);
  const autoPrintedFor = useRef<string | null>(null);
  const [pendingLocale, setPendingLocale] = useState<string | null>(null);

  const variableSchema = useMemo(
    () => parseJsonObject(detail?.variableSchema ?? null),
    [detail?.variableSchema],
  );
  const settledMeta = current === null ? null : serializePdfMeta(current.settled.meta);

  const validationQuery = useQuery<ValidationResult>(
    TemplateResolverQueries.validate,
    {
      slug,
      kind: DOCUMENT_PDF_KIND,
      contentFormat: "html",
      content: current?.settled.content ?? "",
      meta: settledMeta ?? {},
      variableSchema,
      locale,
      scope,
    },
    { enabled: current !== null },
  );
  const validation = validationQuery.data;

  const layoutSlug = current?.settled.meta.layoutSlug ?? "";
  const previewQuery = useQuery<PreviewResult>(
    TemplateResolverQueries.preview,
    {
      slug,
      kind: DOCUMENT_PDF_KIND,
      locale,
      content: detail?.content ?? "",
      meta: layoutSlug === "" ? {} : { layoutSlug },
      variableSchema,
    },
    { enabled: detail !== null },
  );
  const layout = previewQuery.error === null ? (previewQuery.data?.layout ?? null) : null;

  const layouts = useOverviewRows(PDF_LAYOUT_KIND);
  // The built-in "logo" resource of a layout is the tenant's branding logo.
  const branding = useQuery<BrandingView>(BRANDING_QUERY_QN, {});
  const brandingLogoFile = branding.data?.logoFile ?? "";

  const statusQuery = useQuery<PuppeteerStatus>(RendererPuppeteerClientQueries.status, {});
  const pdfAvailable = statusQuery.error === null && statusQuery.data?.available === true;
  const unavailableMessage =
    statusQuery.data?.available === false ? (statusQuery.data.message ?? "") : "";

  const showOrigin = scope === "system";
  const overridesQuery = useQuery<TenantOverrides>(
    TemplateResolverQueries.tenantOverrides,
    { slug, kind: DOCUMENT_PDF_KIND, locale },
    { enabled: showOrigin && detail !== null },
  );

  const allVariables = validation?.variables ?? NO_VARIABLES;
  // Photos are record data, never an inline placeholder: images variables only feed the Images block.
  const variables = useMemo(() => textVariablesOf(allVariables), [allVariables]);
  const imageVariables = useMemo(
    () => Object.keys(allVariables).filter((name) => allVariables[name]?.type === "images"),
    [allVariables],
  );
  const systemVariables = useMemo(
    () => visibleSystemPlaceholders(validation?.systemPlaceholders ?? []),
    [validation?.systemPlaceholders],
  );
  const systemLabels = useMemo(() => systemLabelMap(t, systemVariables), [t, systemVariables]);
  const variableLabels = useMemo(
    () => ({
      ...systemLabels,
      ...variableLabelMap(t, variables),
      ...variableLabelMap(t, imageLabelSource(allVariables)),
    }),
    [systemLabels, variables, allVariables, t],
  );
  const variableNames = useMemo(() => Object.keys(variables), [variables]);
  const linkedResources = detail?.linkedResources ?? null;
  // The editor shows resource images from the stored copies; no extra request is made here.
  const resourcePreviews = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(parseJsonObject(linkedResources)).flatMap(([key, fileRefId]) =>
          typeof fileRefId === "string"
            ? [[key, { src: `/api/files/${encodeURIComponent(fileRefId)}`, caption: key }]]
            : [],
        ),
      ),
    [linkedResources],
  );
  if (rowsQuery.loading && rowsQuery.data === null) return <LoadingState />;
  if (rowsQuery.error !== null) return <ErrorState error={rowsQuery.error} />;
  if (row === undefined)
    return <Banner variant="info">{t("documentDesigner.notFound", { slug })}</Banner>;
  if (current === null || detail === null) {
    return detailQuery.error !== null ? <ErrorState error={detailQuery.error} /> : <LoadingState />;
  }

  const dirty = snapshotOf(current.draft) !== current.snapshot;
  const generatedFresh = generated !== null && generated.forSnapshot === snapshotOf(current.draft);

  function updateDraft(next: Draft): void {
    setState((previous) => (previous === null ? previous : { ...previous, draft: next }));
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      setState((previous) =>
        previous === null ? previous : { ...previous, settled: previous.draft },
      );
    }, SETTLE_MS);
  }

  function resetDraft(source: TemplateDetail): void {
    const draft = draftFromDetail(source);
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    setState({ key: source.id, draft, settled: draft, snapshot: snapshotOf(draft) });
    setDraftEpoch((epoch) => epoch + 1);
    setActionError(null);
  }

  async function reload(): Promise<void> {
    await Promise.all([rowsQuery.refetch(), detailQuery.refetch(), validationQuery.refetch()]);
  }

  async function persist(): Promise<SaveResult | null> {
    const draft = current?.draft ?? { content: "", meta: EMPTY_PDF_META };
    const parentTemplateId = detail?.scope === "system" ? detail.id : detail?.parentTemplateId;
    const result = await dispatcher.write<SaveResult>(
      scope === "system"
        ? TemplateResolverHandlers.upsertSystem
        : TemplateResolverHandlers.upsertTenant,
      {
        slug,
        kind: DOCUMENT_PDF_KIND,
        locale,
        content: draft.content,
        contentFormat: "html",
        variableSchema,
        meta: serializePdfMeta(draft.meta),
        ...(scope === "tenant" && parentTemplateId != null && { parentTemplateId }),
      },
    );
    if (!result.isSuccess) {
      setActionError(describeError(t, result.error));
      return null;
    }
    setState((previous) =>
      previous === null ? previous : { ...previous, snapshot: snapshotOf(draft) },
    );
    return result.data;
  }

  async function save(): Promise<boolean> {
    setBusy("save");
    setActionError(null);
    const saved = await persist();
    if (saved !== null) await reload();
    setBusy(null);
    return saved !== null;
  }

  async function publish(): Promise<void> {
    setBusy("publish");
    setActionError(null);
    // A system save activates immediately; a tenant row needs a save first when it
    // does not exist yet or carries unsaved edits, then an explicit publish.
    const needsSave = dirty || detail?.scope === "system";
    const saved = needsSave ? await persist() : null;
    const saveFailed = needsSave && saved === null;
    // upsertSystem already activates, so only a tenant row needs the explicit publish.
    const alreadyActivatedBySave = scope === "system" && saved !== null;
    const templateId = saved?.id ?? detail?.id ?? null;
    if (templateId !== null && !saveFailed && !alreadyActivatedBySave) {
      const result = await dispatcher.write(
        scope === "system"
          ? TemplateResolverHandlers.publishSystem
          : TemplateResolverHandlers.publish,
        { id: templateId },
      );
      if (!result.isSuccess && !isAlreadyActive(result.error))
        setActionError(describeError(t, result.error));
    }
    await reload();
    setBusy(null);
  }

  async function generatePdf(): Promise<void> {
    if (current === null) return;
    setMode("preview");
    setBusy("pdf");
    setActionError(null);
    const forSnapshot = snapshotOf(current.draft);
    const result = await dispatcher.query<PdfPreviewResult>(
      RendererPuppeteerClientQueries.previewPdf,
      {
        slug,
        locale,
        content: current.draft.content,
        meta: serializePdfMeta(current.draft.meta),
        variableSchema,
      },
    );
    if (result.isSuccess) setGenerated({ forSnapshot, result: result.data });
    else setActionError(describeError(t, result.error));
    setBusy(null);
  }

  function printOnce(): void {
    if (current === null || autoPrintedFor.current === snapshotOf(current.draft)) return;
    autoPrintedFor.current = snapshotOf(current.draft);
    void generatePdf();
  }

  async function uploadResource(file: File): Promise<void> {
    const sourceFileRefId = await uploadFileRef(file);
    const result = await dispatcher.write(TemplateResolverHandlers.resourceUpload, {
      templateId: detail?.id,
      sourceFileRefId,
    });
    if (!result.isSuccess) throw new Error(describeError(t, result.error));
    await detailQuery.refetch();
  }

  function requestLocale(next: string): void {
    if (next === locale) return;
    if (dirty) setPendingLocale(next);
    else onLocaleChange?.(next);
  }

  const canPublish = validation?.canPublish === true;
  const layoutSlugShown = layout?.slug ?? DEFAULT_LAYOUT_SLUG;
  const layoutName =
    layouts.rows.find((row) => row.slug === layoutSlugShown)?.title ?? layoutSlugShown;
  const layoutResourceSrc = (key: string): string | undefined =>
    key === "logo" && brandingLogoFile !== "" ? fileUrl(brandingLogoFile) : undefined;
  const placeholderSource =
    validation === undefined || validation === null
      ? null
      : {
          ...validation,
          variables,
          systemPlaceholders: visibleSystemPlaceholders(validation.systemPlaceholders),
        };
  const layoutFills = (name: string): boolean =>
    layout !== null &&
    (layout.html.includes(`data-variable="${name}"`) || layout.html.includes(`{{${name}}}`));
  const overrideCount =
    (overridesQuery.data?.activeOverrides ?? 0) + (overridesQuery.data?.draftOverrides ?? 0);
  const resourceKeys = Object.keys(parseJsonObject(detail.linkedResources));
  const overviewRow = overview.rows.find((candidate) => candidate.slug === slug);
  const title = overviewRow === undefined ? slug : templateTitle(t, overviewRow);
  const systemVersion = overviewRow?.systemVersion ?? null;
  const vocabulary = {
    names: variableNames,
    labels: variableLabels,
    system: systemVariables,
  };
  const footer =
    validation === undefined || validation === null
      ? null
      : pdfFooterMessage(
          t,
          validation,
          generated === null
            ? null
            : {
                pages: generated.result.pageCount,
                sizeBytes: generated.result.sizeBytes,
                durationMs: generated.result.durationMs,
              },
        );
  const showOverrideLinks = showOrigin && detail.scope === "system";
  const originText = showOverrideLinks
    ? overridesQuery.data?.totalTenants == null
      ? t("documentDesigner.originBar.noTotal", { count: overrideCount })
      : t("documentDesigner.originBar.withTotal", {
          count: overrideCount,
          total: overridesQuery.data.totalTenants,
        })
    : detail.scope === "system"
      ? t("documentDesigner.mail.origin.system", { version: detail.version })
      : systemVersion === null
        ? t("documentDesigner.mail.origin.tenantOnly")
        : t("documentDesigner.mail.origin.overrides", { version: systemVersion });
  const besideActiveSentence = draftBesideActiveSentence(t, detail);
  const pdfUnavailableNote = !pdfAvailable && statusQuery.loading === false;

  return (
    <EditorFrame testId="pdf-template-editor">
      <EditorHeader
        title={title}
        stored={{ status: detail.status, version: detail.version }}
        actions={{
          busy: busy === "save",
          canSave: busy === null && validation?.canSave !== false,
          canPublish: busy === null && canPublish,
          onSave: () => void save(),
          onPublish: () => void publish(),
        }}
      >
        <EditorModeSwitch testIdPrefix="pdf" mode={mode} onMode={setMode} />
      </EditorHeader>
      <EditorInfoBar
        tone={pdfUnavailableNote ? "warn" : detail.scope === "tenant" ? "active" : "muted"}
        testId="pdf-origin-bar"
        origin={originOf(detail.scope === "system", systemVersion !== null)}
        controls={
          <>
            <EditorLocaleSwitch
              testIdPrefix="pdf"
              locales={locales.length > 0 ? locales : [locale]}
              locale={locale}
              onLocale={requestLocale}
            />
            {mode === "preview" && (
              <Button
                variant="secondary"
                disabled={!pdfAvailable || busy !== null}
                loading={busy === "pdf"}
                onClick={() => void generatePdf()}
                testId="pdf-generate-header"
              >
                {t("documentDesigner.actions.generatePdf")}
              </Button>
            )}
          </>
        }
        overlays={
          <OverridesDrawer
            open={overridesOpen}
            onOpenChange={setOverridesOpen}
            slug={slug}
            locale={locale}
            overrides={overridesQuery.data}
          />
        }
        links={
          showOverrideLinks && (
            <>
              <Button variant="link" onClick={() => void exportBundle()}>
                {t("documentDesigner.originBar.export")}
              </Button>
              <Button variant="link" onClick={() => setOverridesOpen(true)}>
                {t("documentDesigner.originBar.showOverrides")}
              </Button>
            </>
          )
        }
      >
        {originText}
        {besideActiveSentence !== null && ` ${besideActiveSentence}`}
        {pdfUnavailableNote && (
          <>
            {" "}
            <span data-testid="pdf-unavailable">
              {unavailableMessage === ""
                ? t("documentDesigner.pdfUnavailableNoReason")
                : t("documentDesigner.pdfUnavailable", { message: unavailableMessage })}
            </span>
          </>
        )}
      </EditorInfoBar>
      <EditorBody
        left={
          mode === "edit" ? (
            <>
              <PlaceholderSection
                validation={placeholderSource}
                onInsert={insert.insertPlaceholder}
                idPrefix="pdf"
              />
              <SystemPlaceholderSection
                validation={placeholderSource}
                onInsert={insert.insertPlaceholder}
                idPrefix="pdf"
                isLayoutOwned={layoutFills}
              />
              <PdfResourceSection
                resourceKeys={resourceKeys}
                canUpload={detail.scope === scope}
                layoutName={layoutName}
                onInsert={insert.insertResource}
                onUpload={uploadResource}
              />
            </>
          ) : undefined
        }
        center={
          mode === "edit" ? (
            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col"
              onFocusCapture={insert.markFocused("body")}
            >
              <PageCanvas
                meta={current.draft.meta}
                content={current.draft.content}
                onContentChange={(content) => updateDraft({ ...current.draft, content })}
                regions={layout?.regions ?? null}
                layoutName={layoutName}
                resourceSrc={layoutResourceSrc}
                variableLabels={variableLabels}
                systemVariables={systemVariables}
                systemLabels={systemLabels}
                variableNames={variableNames}
                imageVariables={imageVariables}
                resourcePreviews={resourcePreviews}
                onEditorReady={insert.register("body")}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              {generated !== null && generatedFresh ? (
                <PdfPreview
                  source={{ base64: generated.result.pdfBase64 }}
                  testId="document-designer-pdf-preview"
                />
              ) : (
                <div
                  className="flex flex-col items-start gap-3 p-6"
                  data-testid="document-designer-preview-stale"
                >
                  {pdfAvailable && busy === null && <RunOnMount run={printOnce} />}
                  <p className="text-sm text-muted-foreground">
                    {busy === "pdf"
                      ? t("documentDesigner.preview.loading")
                      : t("documentDesigner.preview.stale")}
                  </p>
                  <Button
                    variant="secondary"
                    disabled={!pdfAvailable || busy !== null}
                    onClick={() => void generatePdf()}
                  >
                    {t("documentDesigner.actions.generatePdf")}
                  </Button>
                </div>
              )}
            </div>
          )
        }
        right={
          <SettingsPanel
            meta={current.draft.meta}
            onMetaChange={(meta) => updateDraft({ ...current.draft, meta })}
            layouts={layouts.rows}
            locale={locale}
            version={{ id: detail.id, version: detail.version, status: detail.status }}
            vocabulary={vocabulary}
            insert={insert}
            draftKey={`${current.key}:${draftEpoch}`}
          />
        }
      />
      <EditorFooter
        testIdPrefix="pdf-editor"
        message={footer}
        saveError={actionError}
        modifiedAt={detail.modifiedAt ?? null}
        dirty={dirty}
        busy={busy === "save"}
        canSave={busy === null && validation?.canSave !== false}
        canPublish={busy === null && canPublish}
        onDiscard={() => resetDraft(detail)}
        onSave={() => void save()}
        onPublish={() => void publish()}
      />

      <Dialog
        open={pendingLocale !== null}
        onOpenChange={(open) => {
          if (!open) setPendingLocale(null);
        }}
        title={t("documentDesigner.localeDialog.title")}
        description={t("documentDesigner.localeDialog.description")}
        confirmLabel={t("documentDesigner.localeDialog.save")}
        cancelLabel={t("documentDesigner.localeDialog.cancel")}
        onConfirm={async () => {
          const target = pendingLocale;
          if (target !== null && (await save())) onLocaleChange?.(target);
          setPendingLocale(null);
        }}
      >
        <Button
          variant="danger-ghost"
          onClick={() => {
            const target = pendingLocale;
            setPendingLocale(null);
            resetDraft(detail);
            if (target !== null) onLocaleChange?.(target);
          }}
        >
          {t("documentDesigner.localeDialog.discard")}
        </Button>
      </Dialog>
    </EditorFrame>
  );

  async function exportBundle(): Promise<void> {
    const result = await dispatcher.query<unknown>(TemplateResolverQueries.exportBundle, {
      slug,
      kind: DOCUMENT_PDF_KIND,
      scope: "system",
    });
    if (!result.isSuccess) {
      setActionError(describeError(t, result.error));
      return;
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    // Slugs are namespaced with ":", which browsers rewrite in download names
    // on their own; replacing it here keeps the file name stable everywhere.
    anchor.download = `${slug.replace(/[\\/:*?"<>|]/g, "_")}.bundle.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
