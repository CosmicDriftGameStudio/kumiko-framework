import { PdfPreview } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useEffect } from "react";
import { PlaceholderSection, SystemPlaceholderSection } from "./mail-left-rail.tsx";
import { PageCanvas } from "./page-canvas.tsx";
import type { PdfRenderContext } from "./pdf-editor-context.ts";
import { PdfResourceSection } from "./pdf-left-rail.tsx";
import { SettingsPanel } from "./settings-panel.tsx";

// Opening the preview prints the page without a click; a failed print is not retried for the same draft.
function RunOnMount({ run }: { readonly run: () => void }): null {
  useEffect(() => {
    run();
  }, [run]);
  return null;
}

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
      <PageCanvas
        meta={current.draft.meta}
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
      />
    </div>
  );
}

function renderStalePreview(c: PdfRenderContext): ReactNode {
  const { t, Button, s, view, actions } = c;
  const { busy } = s.ui;
  return (
    <div
      className="flex flex-col items-start gap-3 p-6"
      data-testid="document-designer-preview-stale"
    >
      {view.pdfAvailable && busy === null && <RunOnMount run={actions.printOnce} />}
      <p className="text-sm text-muted-foreground">
        {busy === "pdf"
          ? t("documentDesigner.preview.loading")
          : t("documentDesigner.preview.stale")}
      </p>
      <Button
        variant="secondary"
        disabled={!view.pdfAvailable || busy !== null}
        onClick={() => void actions.generatePdf()}
      >
        {t("documentDesigner.actions.generatePdf")}
      </Button>
    </div>
  );
}

export function renderPdfPreviewPane(c: PdfRenderContext): ReactNode {
  const { generated } = c.s.ui;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {generated !== null && c.view.generatedFresh ? (
        <PdfPreview
          source={{ base64: generated.result.pdfBase64 }}
          testId="document-designer-pdf-preview"
        />
      ) : (
        renderStalePreview(c)
      )}
    </div>
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
      draftKey={`${current.key}:${s.ui.draftEpoch}`}
    />
  );
}
