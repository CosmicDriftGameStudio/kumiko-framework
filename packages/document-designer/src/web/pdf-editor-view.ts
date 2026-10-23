import { fileUrl } from "./file-name.ts";
import type { EditorState } from "./pdf-editor-draft.ts";
import { snapshotOf } from "./pdf-editor-draft.ts";
import { pdfFooterMessage } from "./pdf-footer.ts";
import { visibleSystemPlaceholders } from "./pdf-left-rail.tsx";
import { draftBesideActiveSentence } from "./status-label.ts";
import { parseJsonObject } from "./template-rows.ts";
import { DEFAULT_LAYOUT_SLUG, type TemplateDetail } from "./types.ts";
import type { PdfEditorState } from "./use-pdf-editor-state.ts";
import { templateTitle, templateTitleText } from "./used-by-label.ts";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

function originTextOf(
  t: Translate,
  s: PdfEditorState,
  detail: TemplateDetail,
  systemVersion: number | null,
  showOverrideLinks: boolean,
): string {
  const overrides = s.server.overridesQuery.data;
  if (showOverrideLinks) {
    const overrideCount = (overrides?.activeOverrides ?? 0) + (overrides?.draftOverrides ?? 0);
    return overrides?.totalTenants == null
      ? t("documentDesigner.originBar.noTotal", { count: overrideCount })
      : t("documentDesigner.originBar.withTotal", {
          count: overrideCount,
          total: overrides.totalTenants,
        });
  }
  if (detail.scope === "system")
    return t("documentDesigner.mail.origin.system", { version: detail.version });
  return systemVersion === null
    ? t("documentDesigner.mail.origin.tenantOnly")
    : t("documentDesigner.mail.origin.overrides", { version: systemVersion });
}

function footerOf(t: Translate, s: PdfEditorState) {
  const { validation } = s.server;
  const { generated } = s.ui;
  if (validation === undefined || validation === null) return null; // skip: nothing validated yet
  return pdfFooterMessage(
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
}

function layoutNameOf(t: Translate, s: PdfEditorState, layoutSlugShown: string): string {
  const layoutTitle = s.server.layouts.rows.find((row) => row.slug === layoutSlugShown)?.title;
  return layoutTitle === undefined ? layoutSlugShown : templateTitleText(t, layoutTitle);
}

function placeholderSourceOf(s: PdfEditorState) {
  const { validation } = s.server;
  return validation === undefined || validation === null
    ? null
    : {
        ...validation,
        variables: s.vocabulary.variables,
        systemPlaceholders: visibleSystemPlaceholders(validation.systemPlaceholders),
      };
}

export function buildPdfView(input: {
  readonly t: Translate;
  readonly s: PdfEditorState;
  readonly slug: string;
  readonly current: EditorState;
  readonly detail: TemplateDetail;
}) {
  const { t, s, slug, current, detail } = input;
  const { layout, validation, statusQuery, brandingLogoFile } = s.server;
  const { generated } = s.ui;
  const pdfAvailable = statusQuery.error === null && statusQuery.data?.available === true;
  const unavailableMessage =
    statusQuery.data?.available === false ? (statusQuery.data.message ?? "") : "";
  const layoutSlugShown = layout?.slug ?? DEFAULT_LAYOUT_SLUG;
  const layoutName = layoutNameOf(t, s, layoutSlugShown);
  const overviewRow = s.host.overview.rows.find((candidate) => candidate.slug === slug);
  const systemVersion = overviewRow?.systemVersion ?? null;
  const showOverrideLinks = s.server.showOrigin && detail.scope === "system";

  return {
    dirty: snapshotOf(current.draft) !== current.snapshot,
    generatedFresh: generated !== null && generated.forSnapshot === snapshotOf(current.draft),
    canPublish: validation?.canPublish === true,
    pdfAvailable,
    unavailableMessage,
    pdfUnavailableNote: !pdfAvailable && statusQuery.loading === false,
    layoutName,
    layoutResourceSrc: (key: string): string | undefined =>
      key === "logo" && brandingLogoFile !== "" ? fileUrl(brandingLogoFile) : undefined,
    placeholderSource: placeholderSourceOf(s),
    layoutFills: (name: string): boolean =>
      layout !== null &&
      (layout.html.includes(`data-variable="${name}"`) || layout.html.includes(`{{${name}}}`)),
    resourceKeys: Object.keys(parseJsonObject(detail.linkedResources)),
    title: overviewRow === undefined ? slug : templateTitle(t, overviewRow),
    systemVersion,
    vocabulary: {
      names: s.vocabulary.variableNames,
      labels: s.vocabulary.variableLabels,
      system: s.vocabulary.systemVariables,
    },
    footer: footerOf(t, s),
    showOverrideLinks,
    originText: originTextOf(t, s, detail, systemVersion, showOverrideLinks),
    besideActiveSentence: draftBesideActiveSentence(t, detail),
  };
}

export type PdfView = ReturnType<typeof buildPdfView>;
