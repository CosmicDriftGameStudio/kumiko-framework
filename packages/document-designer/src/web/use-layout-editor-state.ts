import {
  type DocumentEditorHandle,
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useMutation, useQuery } from "@cosmicdrift/kumiko-renderer";
import type { Translate } from "@cosmicdrift/kumiko-renderer/headless";
import { useRef, useState } from "react";
import {
  accentLineShown,
  appearanceFlags,
  type EditorTab,
  footerMessageOf,
  initialTab,
  layoutBlocks,
  layoutContent,
  layoutDirty,
  layoutSaveFlags,
  type Region,
  resourcePreviewsOf,
  saveLayout,
  shownRowOf,
} from "./layout-editor-logic.ts";
import {
  appearanceOf,
  isPdfLayoutLookValid,
  pdfLayoutLookOf,
  pdfLayoutMetaToSave,
  samePdfLayoutLook,
} from "./layout-meta.ts";
import type {
  LayoutKind,
  LayoutSourceView,
  LayoutValidation,
  TenantOverrideCounts,
  UpsertResponse,
} from "./layout-types.ts";
import { systemLabelMap } from "./mail-draft.ts";
import type { OverviewRowView } from "./overview-row.ts";
import { useBranding } from "./use-branding.ts";
import { useDebouncedValue } from "./use-debounced-value.ts";

// Server-side validation compiles the whole layout (mjml), so wait for a pause in typing.
const VALIDATE_DEBOUNCE_MS = 400;

export type LayoutEditorBodyProps = {
  readonly kind: LayoutKind;
  readonly slug: string;
  readonly isSystemAdmin: boolean;
  readonly source: LayoutSourceView;
  readonly overviewRows: readonly OverviewRowView[];
  readonly usedByCount: number;
  readonly overrides: TenantOverrideCounts | null;
  readonly onKindChange: (kind: LayoutKind) => void;
  readonly onReload: () => Promise<void>;
};

export function useLayoutEditorState(props: LayoutEditorBodyProps, t: Translate) {
  const { kind, slug, isSystemAdmin, source, usedByCount, onKindChange, onReload } = props;
  const isMail = kind === "mail-layout";
  const showMjmlTab = isSystemAdmin && source.mjmlSource !== null;

  const [tab, setTab] = useState<EditorTab>(initialTab(showMjmlTab, source));
  const [header, setHeader] = useState(source.regions.header);
  const [signature, setSignature] = useState(source.regions.signature);
  const [footer, setFooter] = useState(source.regions.footer);
  const [mjml, setMjml] = useState(source.mjmlSource ?? "");
  const storedAppearance = appearanceOf(source.meta);
  const [appearance, setAppearance] = useState(storedAppearance);
  const storedPdfLook = pdfLayoutLookOf(source.meta);
  const [pdfLook, setPdfLook] = useState(storedPdfLook);
  const [activeRegion, setActiveRegion] = useState<Region>("header");
  const regionHandles = useRef<Partial<Record<Region, DocumentEditorHandle>>>({});
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const [pendingKind, setPendingKind] = useState<LayoutKind | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const upsertTenant = useMutation<UpsertResponse>(TemplateResolverHandlers.upsertTenant);
  const upsertSystem = useMutation<UpsertResponse>(TemplateResolverHandlers.upsertSystem);
  const publishSystem = useMutation(TemplateResolverHandlers.publishSystem);
  const branding = useBranding();

  const mjmlMode = tab === "mjml";
  const { appearanceFromMjml, appearanceEditable, appearanceValid } = appearanceFlags({
    isMail,
    mjmlMode,
    source,
    appearance,
  });
  const pdfLookDirty = !isMail && !samePdfLayoutLook(pdfLook, storedPdfLook);
  const pdfLookValid = isMail || isPdfLayoutLookValid(pdfLook);
  const dirty =
    pdfLookDirty ||
    layoutDirty({
      mjmlMode,
      mjml,
      header,
      signature,
      footer,
      appearance,
      storedAppearance,
      appearanceEditable,
      source,
    });

  const content = layoutContent({ mjmlMode, mjml, header, signature, footer, isMail });
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

  const shownRow = shownRowOf(isSystemAdmin, source);
  const userCount = usedByCount;
  const placeholders = checked?.systemPlaceholders ?? [];
  const placeholderLabels = systemLabelMap(t, placeholders);

  const requestKind = (next: LayoutKind): void => {
    // skip: the requested kind is already open
    if (next === kind) return;
    if (dirty) setPendingKind(next);
    else onKindChange(next);
  };

  const save = (publish: boolean): Promise<void> =>
    saveLayout({
      publish,
      kind,
      slug,
      source,
      content,
      mjmlMode,
      isMail,
      isSystemAdmin,
      appearanceEditable,
      appearance,
      ...(isMail ? {} : { pdfMeta: pdfLayoutMetaToSave(pdfLook, source.meta) }),
      t,
      upsertTenant,
      upsertSystem,
      publishSystem,
      setSaveError,
      onReload,
    });

  const busy = upsertTenant.pending || upsertSystem.pending || publishSystem.pending;
  const { canSave, canPublish } = layoutSaveFlags({
    dirty,
    checked,
    appearanceValid: appearanceValid && pdfLookValid,
    busy,
    shownRow,
  });
  const checkedFooterMessage = footerMessageOf({ t, checked, appearanceValid, isMail, userCount });
  const footerMessage: typeof checkedFooterMessage = pdfLookValid
    ? checkedFooterMessage
    : { tone: "bad", text: t("documentDesigner.appearance.pdfInvalid") };

  const accentColor = branding.data?.accentColor ?? "";
  const showAccentLine = accentLineShown({ isMail, appearanceEditable, appearance, accentColor });
  const blocks = layoutBlocks(isMail);
  const resourcePreviews = resourcePreviewsOf(branding.data, isMail, t);

  // The region editors are lazy and report their handle once loaded; company data goes into the focused region.
  const registerRegion =
    (region: Region) =>
    (handle: DocumentEditorHandle | null): void => {
      if (handle === null) delete regionHandles.current[region];
      else regionHandles.current[region] = handle;
    };
  const insertIntoActiveRegion = (name: string): void =>
    regionHandles.current[activeRegion]?.insertPlaceholder(name);

  const discard = (): void => {
    setHeader(source.regions.header);
    setSignature(source.regions.signature);
    setFooter(source.regions.footer);
    setMjml(source.mjmlSource ?? "");
    setAppearance(storedAppearance);
    setPdfLook(storedPdfLook);
    setSaveError(null);
  };

  return {
    isMail,
    showMjmlTab,
    tab,
    setTab,
    header,
    setHeader,
    signature,
    setSignature,
    footer,
    setFooter,
    mjml,
    setMjml,
    appearance,
    pdfLook,
    setPdfLook,
    registerRegion,
    insertIntoActiveRegion,
    setAppearance,
    activeRegion,
    setActiveRegion,
    toolbarHost,
    setToolbarHost,
    pendingKind,
    setPendingKind,
    saveError,
    setSaveError,
    branding,
    mjmlMode,
    appearanceFromMjml,
    dirty,
    checked,
    shownRow,
    userCount,
    placeholders,
    placeholderLabels,
    requestKind,
    save,
    busy,
    canSave,
    canPublish,
    footerMessage,
    accentColor,
    showAccentLine,
    blocks,
    resourcePreviews,
    discard,
  };
}

export type LayoutEditorModel = ReturnType<typeof useLayoutEditorState>;
