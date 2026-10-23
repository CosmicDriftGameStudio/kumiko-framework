import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { ErrorState, LoadingState } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import { EditorBody, EditorFrame } from "./editor-shell.tsx";
import { describeError } from "./errors.ts";
import { buildPdfActions } from "./pdf-editor-actions.ts";
import {
  renderPdfFooter,
  renderPdfHeader,
  renderPdfInfoBar,
  renderPdfLocaleDialog,
} from "./pdf-editor-chrome.tsx";
import type { PdfRenderContext } from "./pdf-editor-context.ts";
import {
  renderPdfEditCanvas,
  renderPdfLeftRail,
  renderPdfPreviewPane,
  renderPdfSettings,
} from "./pdf-editor-panes.tsx";
import { buildPdfView } from "./pdf-editor-view.ts";
import { DOCUMENT_PDF_KIND } from "./types.ts";
import { usePdfEditorState } from "./use-pdf-editor-state.ts";

export type PdfTemplateEditorProps = {
  readonly slug: string;
  /** Template locale; defaults to "de", or the first locale the slug has. */
  readonly locale?: string;
  readonly onLocaleChange?: (locale: string) => void;
};

export function PdfTemplateEditor({
  slug,
  locale: requestedLocale,
  onLocaleChange,
}: PdfTemplateEditorProps): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const { Button, Banner, Dialog } = usePrimitives();
  const s = usePdfEditorState({ slug, requestedLocale }, t);
  const { rowsQuery, row, current, detail, detailQuery } = s.doc;
  if (rowsQuery.loading && rowsQuery.data === null) return <LoadingState />;
  if (rowsQuery.error !== null) return <ErrorState error={rowsQuery.error} />;
  if (row === undefined)
    return <Banner variant="info">{t("documentDesigner.notFound", { slug })}</Banner>;
  if (current === null || detail === null) {
    return detailQuery.error !== null ? <ErrorState error={detailQuery.error} /> : <LoadingState />;
  }

  const view = buildPdfView({ t, s, slug, current, detail });
  const actions = buildPdfActions({
    s,
    t,
    dispatcher,
    slug,
    current,
    detail,
    dirty: view.dirty,
    onLocaleChange,
  });
  const context: PdfRenderContext = {
    t,
    Button,
    Dialog,
    slug,
    s,
    actions,
    view,
    current,
    detail,
    onLocaleChange,
    exportBundle,
  };
  const editing = s.ui.mode === "edit";

  return (
    <EditorFrame testId="pdf-template-editor">
      {renderPdfHeader(context)}
      {renderPdfInfoBar(context)}
      <EditorBody
        left={editing ? renderPdfLeftRail(context) : undefined}
        center={editing ? renderPdfEditCanvas(context) : renderPdfPreviewPane(context)}
        right={renderPdfSettings(context)}
      />
      {renderPdfFooter(context)}

      {renderPdfLocaleDialog(context)}
    </EditorFrame>
  );

  async function exportBundle(): Promise<void> {
    const result = await dispatcher.query<unknown>(TemplateResolverQueries.exportBundle, {
      slug,
      kind: DOCUMENT_PDF_KIND,
      scope: "system",
    });
    if (!result.isSuccess) {
      s.ui.setActionError(describeError(t, result.error));
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
