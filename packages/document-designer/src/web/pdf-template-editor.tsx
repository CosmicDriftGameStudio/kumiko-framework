// @runtime client
import {
  type DocumentEditorHandle,
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
import { RendererPuppeteerClientQueries } from "@cosmicdrift/kumiko-renderer-puppeteer-client/qualified-names";
import {
  ErrorState,
  LoadingState,
  ModeSwitch,
  StatusBadge,
  uploadFileRef,
} from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeError, isAlreadyActive } from "./errors.js";
import { OverridesDrawer } from "./overrides-drawer.js";
import { PageCanvas } from "./page-canvas.js";
import { EMPTY_PDF_META, type PdfMetaDraft, parsePdfMeta, serializePdfMeta } from "./pdf-meta.js";
import { PdfPreview } from "./pdf-preview.js";
import {
  PlaceholderPanel,
  type SystemPlaceholderRow,
  visibleSystemPlaceholders,
} from "./placeholder-panel.js";
import { SettingsPanel } from "./settings-panel.js";
import { localesOf, parseJsonObject, pickRow, resolveLocale } from "./template-rows.js";
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
} from "./types.js";

const SETTLE_MS = 500;
const NO_VARIABLES: Readonly<Record<string, VariableInfo>> = {};
const SYSTEM_LABEL_NAMES = ["tenantName", "imprint", "signature", "page", "pages"] as const;
// Page numbers share one row in the panel; "pages" is inserted with "page".
const MERGED_SYSTEM_PLACEHOLDERS: ReadonlySet<string> = new Set(["pages"]);

type Draft = { readonly content: string; readonly meta: PdfMetaDraft };

type EditorState = {
  readonly key: string;
  readonly draft: Draft;
  // The draft the server-side checks run against; trails the draft by SETTLE_MS while typing.
  readonly settled: Draft;
  readonly snapshot: string;
};

type GeneratedPdf = { readonly forSnapshot: string; readonly result: PdfPreviewResult };

type ViewMode = "edit" | "preview";

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

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PdfTemplateEditor({
  slug,
  locale: requestedLocale,
  onLocaleChange,
}: PdfTemplateEditorProps): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const { Button, Banner, Dialog } = usePrimitives();
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
  const editorHandle = useRef<DocumentEditorHandle | null>(null);
  const [mode, setMode] = useState<ViewMode>("edit");
  const [busy, setBusy] = useState<"save" | "publish" | "pdf" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedPdf | null>(null);
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

  const layoutsQuery = useQuery<readonly TemplateListRow[]>(TemplateResolverQueries.list, {
    kind: PDF_LAYOUT_KIND,
    locale,
  });
  const layoutSlugs = [
    ...new Set((layoutsQuery.data ?? []).map((layoutRow) => layoutRow.slug)),
  ].sort();

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

  const variables = validation?.variables ?? NO_VARIABLES;
  const systemLabel = useCallback(
    (name: string): string => {
      const label = t(`documentDesigner.system.${name}`);
      return label === `documentDesigner.system.${name}` ? name : label;
    },
    [t],
  );
  const variableLabels = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(variables).flatMap(([name, info]) =>
          info.label === undefined ? [] : [[name, info.label]],
        ),
      ),
    [variables],
  );
  const systemLabels = useMemo(
    () => Object.fromEntries(SYSTEM_LABEL_NAMES.map((name) => [name, systemLabel(name)])),
    [systemLabel],
  );
  const systemVariables = useMemo(
    () => visibleSystemPlaceholders(validation?.systemPlaceholders ?? []),
    [validation?.systemPlaceholders],
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
  const onEditorReady = useCallback((handle: DocumentEditorHandle) => {
    editorHandle.current = handle;
  }, []);

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

  function switchMode(next: ViewMode): void {
    setMode(next);
    if (next === "preview" && pdfAvailable && !generatedFresh && busy === null) void generatePdf();
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

  const used = validation?.used ?? [];
  const missingRequired = validation?.missingRequired ?? [];
  const layoutName = layout?.slug ?? DEFAULT_LAYOUT_SLUG;
  const systemNames = visibleSystemPlaceholders(validation?.systemPlaceholders ?? []).filter(
    (name) => !MERGED_SYSTEM_PLACEHOLDERS.has(name),
  );
  const systemRows: SystemPlaceholderRow[] = systemNames.map((name) => ({
    name,
    label: systemLabel(name),
    status: used.includes(name)
      ? "used"
      : layout !== null &&
          (layout.html.includes(`data-variable="${name}"`) || layout.html.includes(`{{${name}}}`))
        ? "layout"
        : "unused",
  }));
  const overrideCount =
    (overridesQuery.data?.activeOverrides ?? 0) + (overridesQuery.data?.draftOverrides ?? 0);
  const canPublish = validation?.canPublish === true;
  const issueTexts = [...(validation?.issues ?? []), ...(validation?.publishIssues ?? [])].map(
    (issue) => t(issue.i18nKey, issue.params),
  );
  const resourceKeys = Object.keys(parseJsonObject(detail.linkedResources));

  const actions = (
    <>
      <Button variant="ghost" disabled={!dirty || busy !== null} onClick={() => resetDraft(detail)}>
        {t("documentDesigner.actions.discard")}
      </Button>
      <Button
        variant="secondary"
        disabled={busy !== null || validation?.canSave === false}
        loading={busy === "save"}
        onClick={() => void save()}
      >
        {t("documentDesigner.actions.save")}
      </Button>
      <Button
        variant="primary"
        disabled={busy !== null || !canPublish}
        loading={busy === "publish"}
        onClick={() => void publish()}
      >
        {t("documentDesigner.actions.publish")}
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="pdf-template-editor">
      <header className="flex flex-wrap items-center gap-3">
        <nav className="text-sm text-muted-foreground">
          {scope === "system" ? `${t("documentDesigner.breadcrumb.platform")} › ` : ""}
          {t("documentDesigner.breadcrumb.templates")} ›{" "}
          <span className="text-foreground">{slug}</span>
        </nav>
        <StatusBadge tone={detail.status === "active" ? "ok" : "warn"}>
          {t(
            detail.status === "active"
              ? "documentDesigner.status.activeVersion"
              : "documentDesigner.status.draftVersion",
            { version: detail.version },
          )}
        </StatusBadge>
        <StatusBadge tone="muted">
          {t(
            detail.scope === "system"
              ? "documentDesigner.origin.system"
              : "documentDesigner.origin.tenant",
          )}
        </StatusBadge>
        <ModeSwitch
          ariaLabel={t("documentDesigner.locale")}
          value={locale}
          onChange={requestLocale}
          options={(locales.length > 0 ? locales : [locale]).map((value) => ({
            value,
            label: value.toUpperCase(),
          }))}
        />
        <ModeSwitch<ViewMode>
          ariaLabel={t("documentDesigner.mode.label")}
          variant="pill"
          value={mode}
          onChange={switchMode}
          options={[
            { value: "edit", label: t("documentDesigner.mode.edit") },
            { value: "preview", label: t("documentDesigner.mode.preview") },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={!pdfAvailable || busy !== null}
            loading={busy === "pdf"}
            onClick={() => void generatePdf()}
          >
            {t("documentDesigner.actions.generatePdf")}
          </Button>
          {actions}
        </div>
      </header>

      {showOrigin && detail.scope === "system" && (
        <Banner variant="info">
          {overridesQuery.data?.totalTenants == null
            ? t("documentDesigner.originBar.noTotal", { count: overrideCount })
            : t("documentDesigner.originBar.withTotal", {
                count: overrideCount,
                total: overridesQuery.data.totalTenants,
              })}{" "}
          <Button variant="link" onClick={() => void exportBundle()}>
            {t("documentDesigner.originBar.export")}
          </Button>{" "}
          <Button variant="link" onClick={() => setOverridesOpen(true)}>
            {t("documentDesigner.originBar.showOverrides")}
          </Button>
        </Banner>
      )}
      <OverridesDrawer
        open={overridesOpen}
        onOpenChange={setOverridesOpen}
        slug={slug}
        overrides={overridesQuery.data}
      />
      {!pdfAvailable && statusQuery.loading === false && (
        <Banner variant="warning">
          {t("documentDesigner.pdfUnavailable", { message: unavailableMessage })}
        </Banner>
      )}
      {actionError !== null && <Banner variant="error">{actionError}</Banner>}

      <div className="grid grid-cols-[260px_minmax(0,1fr)_300px] items-start gap-4">
        <PlaceholderPanel
          variables={variables}
          used={used}
          missingRequired={missingRequired}
          systemRows={systemRows}
          resourceKeys={resourceKeys}
          canUpload={detail.scope === scope}
          layoutName={layoutName}
          onInsert={(name) => editorHandle.current?.insertPlaceholder(name)}
          onInsertResource={(key) => editorHandle.current?.insertResource(key)}
          onUpload={uploadResource}
        />
        {mode === "edit" ? (
          <PageCanvas
            meta={current.draft.meta}
            content={current.draft.content}
            onContentChange={(content) => updateDraft({ ...current.draft, content })}
            regions={layout?.regions ?? null}
            layoutName={layoutName}
            variableLabels={variableLabels}
            systemVariables={systemVariables}
            systemLabels={systemLabels}
            variableNames={variableNames}
            resourcePreviews={resourcePreviews}
            onEditorReady={onEditorReady}
          />
        ) : generated !== null && generatedFresh ? (
          <PdfPreview pdfBase64={generated.result.pdfBase64} />
        ) : (
          <div
            className="flex flex-col items-start gap-3 bg-muted p-6"
            data-testid="document-designer-preview-stale"
          >
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
        <SettingsPanel
          meta={current.draft.meta}
          onMetaChange={(meta) => updateDraft({ ...current.draft, meta })}
          layoutSlugs={layoutSlugs}
          locale={locale}
          version={{
            version: detail.version,
            status: detail.status,
            modifiedAt: detail.modifiedAt,
          }}
        />
      </div>

      <footer className="flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3">
        <ul
          className="m-0 flex list-none flex-col gap-1 p-0 text-sm"
          data-testid="document-designer-validation"
        >
          {missingRequired.length === 0 && validation !== undefined && validation !== null && (
            <li className="text-status-ok">{t("documentDesigner.validation.ok")}</li>
          )}
          {missingRequired.map((name) => (
            <li key={name} className="text-status-bad">
              {t("documentDesigner.validation.missingRequired", {
                name: variables[name]?.label ?? name,
              })}
            </li>
          ))}
          {issueTexts.map((text) => (
            <li key={text} className="text-status-bad">
              {text}
            </li>
          ))}
          {(validation?.warnings ?? []).map((warning) => (
            <li key={`${warning.code}:${warning.detail}`} className="text-status-warn">
              {t(warning.i18nKey, { detail: warning.detail })}
            </li>
          ))}
          {generated !== null && (
            <li className="text-muted-foreground">
              {t("documentDesigner.validation.lastProbe", {
                pages: generated.result.pageCount,
                size: formatSize(generated.result.sizeBytes),
                seconds: (generated.result.durationMs / 1000).toFixed(1),
              })}
            </li>
          )}
        </ul>
        <div className="flex items-center gap-2">{actions}</div>
      </footer>

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
    </div>
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
    anchor.download = `${slug}.bundle.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
