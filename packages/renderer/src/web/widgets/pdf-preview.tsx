// @runtime client
import type { PDFDocumentProxy } from "pdfjs-dist";
import { type ReactNode, Suspense, use, useEffect } from "react";
import { useTranslation } from "../../i18n.tsx";
import { documentCache, documentFor, documentKey, type PdfPreviewSource } from "./pdf-document.ts";
import { PdfPageSlot, useFirstPageSize } from "./pdf-page.tsx";
import type { PdfMatchInfo } from "./pdf-search.ts";
import { PdfViewer } from "./pdf-viewer.tsx";

export type { PdfPreviewSource } from "./pdf-document.ts";
export type { PdfMatchInfo } from "./pdf-search.ts";

export type PdfPreviewProps = {
  readonly source: PdfPreviewSource;
  readonly testId?: string;
  /** "stacked" = all pages under each other. "viewer" = thumbnail rail, page jump, zoom, search. */
  readonly variant?: "stacked" | "viewer";
  /** Highlights matches in the text layer; the viewer opens on the first hit and shows "Treffer n von m". */
  readonly searchTerm?: string;
  /** 1-based page to open on. */
  readonly initialPage?: number;
  readonly onPageChange?: (page: number) => void;
  /** Viewer only: 0-based active match, controlled by the host (e.g. its own "Treffer 1 von 3" stepper). */
  readonly matchIndex?: number;
  /** Viewer only: reports the match count and active index whenever either changes. */
  readonly onMatchesChange?: (info: PdfMatchInfo) => void;
  /** Viewer only: hides the toolbar's own search controls. */
  readonly hideSearchBar?: boolean;
};

function StackedPages({ document }: { document: PDFDocumentProxy }): ReactNode {
  const firstPageSize = useFirstPageSize(document);
  const layout = { variant: "stacked", zoom: 1, highlight: null } as const;
  return (
    <>
      {Array.from({ length: document.numPages }, (_, index) => index + 1).map((pageNumber) => (
        <PdfPageSlot
          key={pageNumber}
          document={document}
          pageNumber={pageNumber}
          firstPageSize={firstPageSize}
          layout={layout}
        />
      ))}
    </>
  );
}

function Pages({
  source,
  variant,
  searchTerm,
  initialPage,
  ...viewerProps
}: Required<Pick<PdfPreviewProps, "variant">> &
  Omit<PdfPreviewProps, "variant" | "testId">): ReactNode {
  const t = useTranslation();
  const loaded = use(documentFor(source));
  // A mounted preview keeps its document out of the eviction: destroying it blanks its pages.
  const key = documentKey(source);
  useEffect(() => documentCache.retain(key), [key]);
  if (!loaded.ok) {
    return <p className="text-sm text-status-bad">{t("kumiko.widget.pdf-preview.renderFailed")}</p>;
  }
  if (variant === "viewer") {
    return (
      <PdfViewer
        document={loaded.document}
        searchTerm={searchTerm}
        initialPage={initialPage}
        {...viewerProps}
      />
    );
  }
  return <StackedPages document={loaded.document} />;
}

/** PDF pages rendered with pdf.js; pages render lazily as they scroll into view. */
export function PdfPreview({
  source,
  testId = "pdf-preview",
  variant = "stacked",
  searchTerm,
  initialPage,
  ...viewerProps
}: PdfPreviewProps): ReactNode {
  const t = useTranslation();
  return (
    <div
      className={
        variant === "viewer"
          ? "h-full min-h-[480px]"
          : "flex flex-col items-stretch gap-4 overflow-auto"
      }
      data-testid={testId}
    >
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">{t("kumiko.widget.pdf-preview.loading")}</p>
        }
      >
        <Pages
          source={source}
          variant={variant}
          searchTerm={searchTerm}
          initialPage={initialPage}
          {...viewerProps}
        />
      </Suspense>
    </div>
  );
}
