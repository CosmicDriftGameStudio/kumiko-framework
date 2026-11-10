import { PreviewPane } from "@cosmicdrift/kumiko-renderer";
import { LoadingState } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import { PlaceholderSection, SystemPlaceholderSection } from "./mail-left-rail.tsx";
import { PageCanvas } from "./page-canvas.tsx";
import type { PdfRenderContext } from "./pdf-editor-context.ts";
import { PdfCompanyDataSection, PdfResourceSection } from "./pdf-left-rail.tsx";
import { serializePdfMeta } from "./pdf-meta.ts";
import { type PdfPreviewController, PdfPreviewControllerContext } from "./pdf-preview-renderer.tsx";
import { SettingsPanel } from "./settings-panel.tsx";
import { DOCUMENT_PDF_KIND } from "./types.ts";

export function renderPdfLeftRail(c: PdfRenderContext): ReactNode {
  const { s, view, detail, actions } = c;
  const { insert, filesAvailable, scope } = s.host;
  return (
    <>
      <PlaceholderSection
        validation={view.placeholderSource}
        onInsert={insert.insertPlaceholder}
        idPrefix="pdf"
      />
      <PdfCompanyDataSection
        onInsertPlaceholder={insert.insertPlaceholder}
        used={view.companyDataUsed}
      />
      <SystemPlaceholderSection
        validation={view.placeholderSource}
        onInsert={insert.insertPlaceholder}
        idPrefix="pdf"
        isLayoutOwned={view.layoutFills}
      />
      <PdfResourceSection
        resourceKeys={view.resourceKeys}
        canUpload={detail.scope === scope}
        filesAvailable={filesAvailable}
        layoutName={view.layoutName}
        onInsert={insert.insertResource}
        onUpload={actions.uploadResource}
      />
    </>
  );
}

export function renderPdfEditCanvas(c: PdfRenderContext): ReactNode {
  const { s, view, current, actions } = c;
  const { insert } = s.host;
  const { vocabulary } = s;
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onFocusCapture={insert.markFocused("body")}
    >
      {s.server.paperReady ? (
        <PageCanvas
          meta={current.draft.meta}
          layoutMeta={s.server.layoutMeta}
          content={current.draft.content}
          onContentChange={(content) => actions.updateDraft({ ...current.draft, content })}
          regions={s.server.layout?.regions ?? null}
          layoutName={view.layoutName}
          resourceSrc={view.layoutResourceSrc}
          variableLabels={vocabulary.variableLabels}
          systemVariables={vocabulary.systemVariables}
          systemLabels={vocabulary.systemLabels}
          variableNames={vocabulary.variableNames}
          imageVariables={vocabulary.imageVariables}
          resourcePreviews={vocabulary.resourcePreviews}
          onEditorReady={insert.register("body")}
          onFrameControlChange={s.ui.setFrameControl}
        />
      ) : (
        // The canvas background has the skeleton colour, so the rows sit on a sheet.
        <div className="m-6 rounded-md bg-card p-6 shadow-sm">
          <LoadingState rows={8} />
        </div>
      )}
    </div>
  );
}

export function renderPdfPreviewPane(c: PdfRenderContext): ReactNode {
  const { s, view, actions, current, slug } = c;
  const { busy, generated } = s.ui;
  const controller: PdfPreviewController = {
    fresh: generated !== null && view.generatedFresh ? generated.result : null,
    printing: busy === "pdf",
    available: view.pdfAvailable && busy === null,
    generate: () => void actions.generatePdf(),
    printOnce: actions.printOnce,
  };
  return (
    <PdfPreviewControllerContext.Provider value={controller}>
      <PreviewPane
        target="pdf"
        content={current.draft.content}
        editFormat="document"
        variables={{}}
        subject={{
          kind: "template",
          templateKind: DOCUMENT_PDF_KIND,
          slug,
          locale: s.doc.locale,
          meta: serializePdfMeta(current.draft.meta),
          variableSchema: s.server.variableSchema,
        }}
      />
    </PdfPreviewControllerContext.Provider>
  );
}

export function renderPdfSettings(c: PdfRenderContext): ReactNode {
  const { s, view, current, detail, actions } = c;
  return (
    <SettingsPanel
      meta={current.draft.meta}
      onMetaChange={(meta) => actions.updateDraft({ ...current.draft, meta })}
      layouts={s.server.layouts.rows}
      locale={s.doc.locale}
      version={{ id: detail.id, version: detail.version, status: detail.status }}
      vocabulary={view.vocabulary}
      insert={s.host.insert}
      frameControl={s.ui.frameControl}
      paper={view.paper}
      marginsMm={view.marginsMm}
      inheritedMarginsMm={s.server.paperReady ? view.inheritedMarginsMm : null}
      draftKey={`${current.key}:${s.ui.draftEpoch}`}
    />
  );
}
