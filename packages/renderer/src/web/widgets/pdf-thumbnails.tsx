import type { PDFDocumentProxy } from "pdfjs-dist";
import { type ReactNode, Suspense, use, useCallback } from "react";
import { useTranslation } from "../../i18n.tsx";
import { cn } from "../lib/cn.ts";
import { pageFor } from "./pdf-document.ts";
import type { PdfPageSize } from "./pdf-page.tsx";
import { useSeenInViewport } from "./use-in-view.ts";

const THUMBNAIL_WIDTH = 64;

function ThumbnailCanvas({
  document,
  pageNumber,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
}): ReactNode {
  const page = use(pageFor(document, pageNumber));
  const naturalWidth = page.getViewport({ scale: 1 }).width;
  const mountCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (canvas === null) return undefined;
      const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / naturalWidth });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const task = page.render({ canvas, viewport });
      task.promise.catch(() => undefined);
      return () => task.cancel();
    },
    [page, naturalWidth],
  );
  return <canvas ref={mountCanvas} className="block size-full" />;
}

function Thumbnail({
  document,
  pageNumber,
  firstPageSize,
  active,
  onSelect,
}: {
  readonly document: PDFDocumentProxy;
  readonly pageNumber: number;
  readonly firstPageSize: PdfPageSize;
  readonly active: boolean;
  readonly onSelect: (page: number) => void;
}): ReactNode {
  const t = useTranslation();
  const { seen, observe } = useSeenInViewport("200px 0px");
  return (
    <button
      type="button"
      ref={observe}
      aria-label={t("kumiko.widget.pdf-preview.thumbnail", { page: pageNumber })}
      aria-current={active ? "page" : undefined}
      data-testid={`pdf-thumbnail-${pageNumber}`}
      onClick={() => onSelect(pageNumber)}
      className="flex shrink-0 flex-col items-center gap-1 border-0 bg-transparent p-0 text-xs text-foreground-secondary"
    >
      <span
        className={cn(
          "box-border block overflow-hidden rounded-sheet border-2 bg-white",
          active ? "border-primary" : "border-transparent",
        )}
        style={{
          width: THUMBNAIL_WIDTH,
          height: Math.round((THUMBNAIL_WIDTH * firstPageSize.height) / firstPageSize.width),
        }}
      >
        {seen && (
          <Suspense fallback={null}>
            <ThumbnailCanvas document={document} pageNumber={pageNumber} />
          </Suspense>
        )}
      </span>
      {pageNumber}
    </button>
  );
}

/** Left rail of lazily rendered page thumbnails; the active page gets a primary border. */
export function PdfThumbnails({
  document,
  firstPageSize,
  currentPage,
  onSelect,
}: {
  readonly document: PDFDocumentProxy;
  readonly firstPageSize: PdfPageSize;
  readonly currentPage: number;
  readonly onSelect: (page: number) => void;
}): ReactNode {
  const t = useTranslation();
  return (
    <nav
      aria-label={t("kumiko.widget.pdf-preview.pages")}
      className="flex w-28 shrink-0 flex-col items-center gap-3 overflow-y-auto border-r border-border bg-muted py-3"
    >
      {Array.from({ length: document.numPages }, (_, index) => index + 1).map((pageNumber) => (
        <Thumbnail
          key={pageNumber}
          document={document}
          pageNumber={pageNumber}
          firstPageSize={firstPageSize}
          active={pageNumber === currentPage}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
