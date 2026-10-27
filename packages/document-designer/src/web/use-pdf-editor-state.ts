import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useQuery, useUserRoles } from "@cosmicdrift/kumiko-renderer";
import { RendererPuppeteerClientQueries } from "@cosmicdrift/kumiko-renderer-puppeteer-client/qualified-names";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorMode } from "./editor-header.tsx";
import { systemLabelMap, variableLabelMap } from "./mail-draft.ts";
import {
  draftFromDetail,
  type EditorState,
  type GeneratedPdf,
  imageLabelSource,
  NO_VARIABLES,
  snapshotOf,
  textVariablesOf,
} from "./pdf-editor-draft.ts";
import { visibleSystemPlaceholders } from "./pdf-left-rail.tsx";
import { serializePdfMeta } from "./pdf-meta.ts";
import { localesOf, parseJsonObject, pickRow, resolveLocale } from "./template-rows.ts";
import {
  DOCUMENT_PDF_KIND,
  PDF_LAYOUT_KIND,
  type PreviewResult,
  type PuppeteerStatus,
  type TemplateDetail,
  type TemplateListRow,
  type TemplateScope,
  type TenantOverrides,
  type ValidationResult,
} from "./types.ts";
import { useBranding } from "./use-branding.ts";
import { useFilesCapability } from "./use-files-capability.ts";
import { useInsertTargets } from "./use-insert-targets.ts";
import { useOverviewRows } from "./use-overview-rows.ts";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

function usePdfHostServices() {
  const insert = useInsertTargets();
  const filesAvailable = useFilesCapability();
  const overview = useOverviewRows(DOCUMENT_PDF_KIND);
  const roles = useUserRoles();
  const scope: TemplateScope = roles?.includes("SystemAdmin") === true ? "system" : "tenant";
  return { insert, filesAvailable, overview, scope };
}

function usePdfDocument(slug: string, requestedLocale: string | undefined, scope: TemplateScope) {
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
  // useQuery keeps the previous key's data while the next one loads, so a scope or locale
  // switch would otherwise hand the old row to save and publish.
  const detail = row !== undefined && detailQuery.data?.id === row.id ? detailQuery.data : null;

  const [state, setState] = useState<EditorState | null>(null);
  if (detail !== null && (state === null || state.key !== detail.id)) {
    const draft = draftFromDetail(detail);
    setState({ key: detail.id, draft, settled: draft, snapshot: snapshotOf(draft) });
  }
  const current = state !== null && detail !== null && state.key === detail.id ? state : null;
  return { rowsQuery, locales, locale, row, detailQuery, detail, setState, current };
}

function useSettleTimer() {
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A pending settle must not fire into an unmounted editor.
  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    [],
  );
  return settleTimer;
}

function usePdfUiState() {
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [busy, setBusy] = useState<"save" | "publish" | "pdf" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedPdf | null>(null);
  const autoPrintedFor = useRef<string | null>(null);
  const [pendingLocale, setPendingLocale] = useState<string | null>(null);
  return {
    overridesOpen,
    setOverridesOpen,
    draftEpoch,
    setDraftEpoch,
    mode,
    setMode,
    busy,
    setBusy,
    actionError,
    setActionError,
    generated,
    setGenerated,
    autoPrintedFor,
    pendingLocale,
    setPendingLocale,
  };
}

type PdfDocument = ReturnType<typeof usePdfDocument>;

function usePdfServerQueries(input: {
  readonly slug: string;
  readonly scope: TemplateScope;
  readonly doc: PdfDocument;
}) {
  const { slug, scope } = input;
  const { locale, detail, current } = input.doc;
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
  const branding = useBranding();
  const brandingLogoFile = branding.data?.logoFile ?? "";

  const statusQuery = useQuery<PuppeteerStatus>(RendererPuppeteerClientQueries.status, {});

  const showOrigin = scope === "system";
  const overridesQuery = useQuery<TenantOverrides>(
    TemplateResolverQueries.tenantOverrides,
    { slug, kind: DOCUMENT_PDF_KIND, locale },
    { enabled: showOrigin && detail !== null },
  );
  return {
    variableSchema,
    validationQuery,
    validation,
    layout,
    layouts,
    brandingLogoFile,
    statusQuery,
    showOrigin,
    overridesQuery,
  };
}

type PdfServerQueries = ReturnType<typeof usePdfServerQueries>;

function usePdfVocabulary(
  t: Translate,
  validation: PdfServerQueries["validation"],
  detail: PdfDocument["detail"],
) {
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
  return {
    variables,
    imageVariables,
    systemVariables,
    systemLabels,
    variableLabels,
    variableNames,
    resourcePreviews,
  };
}

export function usePdfEditorState(
  input: { readonly slug: string; readonly requestedLocale: string | undefined },
  t: Translate,
) {
  const { slug, requestedLocale } = input;
  const host = usePdfHostServices();
  const doc = usePdfDocument(slug, requestedLocale, host.scope);
  const settleTimer = useSettleTimer();
  const ui = usePdfUiState();
  const server = usePdfServerQueries({ slug, scope: host.scope, doc });
  const vocabulary = usePdfVocabulary(t, server.validation, doc.detail);
  return { host, doc, settleTimer, ui, server, vocabulary };
}

export type PdfEditorState = ReturnType<typeof usePdfEditorState>;
