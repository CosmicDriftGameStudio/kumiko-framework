import { type PreviewRenderer, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { PdfPreview } from "@cosmicdrift/kumiko-renderer/web";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import type { PdfPreviewResult } from "./types.ts";

/** What the PDF editor knows about the printed page: print state is shared with its header and footer buttons. */
export type PdfPreviewController = {
  /** The printed page when it matches the current draft, else null. */
  readonly fresh: PdfPreviewResult | null;
  readonly printing: boolean;
  readonly available: boolean;
  readonly generate: () => void;
  /** Prints once per draft; opening the preview prints without a click. */
  readonly printOnce: () => void;
};

export const PdfPreviewControllerContext = createContext<PdfPreviewController | null>(null);

function RunOnMount({ run }: { readonly run: () => void }): null {
  useEffect(() => {
    run();
  }, [run]);
  return null;
}

// The pdf target: the page is printed by the print service on demand (`previewPdf`, started by the
// editor so its header and footer share the state) and shown in the PDF viewer.
export const PdfPreviewRenderer: PreviewRenderer = (): ReactNode => {
  const t = useTranslation();
  const { Button } = usePrimitives();
  const controller = useContext(PdfPreviewControllerContext);
  if (controller === null) return null;
  const { fresh, printing, available, generate, printOnce } = controller;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {fresh !== null ? (
        <PdfPreview source={{ base64: fresh.pdfBase64 }} testId="document-designer-pdf-preview" />
      ) : (
        <div
          className="flex flex-col items-start gap-3 p-6"
          data-testid="document-designer-preview-stale"
        >
          {available && !printing && <RunOnMount run={printOnce} />}
          <p className="text-sm text-muted-foreground">
            {printing ? t("documentDesigner.preview.loading") : t("documentDesigner.preview.stale")}
          </p>
          <Button variant="secondary" disabled={!available || printing} onClick={generate}>
            {t("documentDesigner.actions.generatePdf")}
          </Button>
        </div>
      )}
    </div>
  );
};
