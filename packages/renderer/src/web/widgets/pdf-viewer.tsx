import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { pageTextItemsFor } from "./pdf-document.ts";
import { PdfPageSlot, useFirstPageSize } from "./pdf-page.tsx";
import { clampPage, findMatches, mostVisiblePage } from "./pdf-search.ts";
import { PdfThumbnails } from "./pdf-thumbnails.tsx";
import { PdfViewerToolbar } from "./pdf-viewer-toolbar.tsx";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
const DEFAULT_ZOOM_INDEX = ZOOM_STEPS.indexOf(1);
const VISIBILITY_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

function pageSlotFor(scroller: HTMLElement | null, page: number): Element | null {
  return scroller?.querySelector(`[data-pdf-page="${page}"]`) ?? null;
}

function useCurrentPage(
  pageCount: number,
  initialPage: number,
  onPageChange: ((page: number) => void) | undefined,
): { readonly currentPage: number; readonly commitPage: (page: number) => void } {
  const [currentPage, setCurrentPage] = useState(clampPage(initialPage, pageCount));
  const latest = useRef({ currentPage, onPageChange });
  latest.current = { currentPage, onPageChange };
  const commitPage = useCallback((page: number) => {
    if (page === latest.current.currentPage) return;
    latest.current = { ...latest.current, currentPage: page };
    setCurrentPage(page);
    latest.current.onPageChange?.(page);
  }, []);
  return { currentPage, commitPage };
}

function useVisiblePageTracking(
  scrollerRef: { readonly current: HTMLElement | null },
  onVisiblePage: (page: number) => void,
): void {
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || typeof IntersectionObserver === "undefined") return undefined;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number(entry.target.getAttribute("data-pdf-page"));
          ratios.set(page, entry.intersectionRatio);
        }
        const page = mostVisiblePage(ratios);
        if (page !== null) onVisiblePage(page);
      },
      { root: scroller, threshold: VISIBILITY_THRESHOLDS },
    );
    for (const slot of scroller.querySelectorAll("[data-pdf-page]")) observer.observe(slot);
    return () => observer.disconnect();
  }, [scrollerRef, onVisiblePage]);
}

function usePageTexts(document: PDFDocumentProxy, wanted: boolean) {
  const [pageTexts, setPageTexts] = useState<readonly (readonly string[])[] | null>(null);
  useEffect(() => {
    if (!wanted) return undefined;
    let cancelled = false;
    void pageTextItemsFor(document)
      .then((texts) => {
        if (!cancelled) setPageTexts(texts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [document, wanted]);
  return pageTexts;
}

/** Thumbnail rail, toolbar (page jump, zoom, search) and lazily rendered pages on a sand frame. */
export function PdfViewer({
  document,
  searchTerm = "",
  initialPage = 1,
  onPageChange,
}: {
  readonly document: PDFDocumentProxy;
  readonly searchTerm?: string;
  readonly initialPage?: number;
  readonly onPageChange?: (page: number) => void;
}): ReactNode {
  const pageCount = document.numPages;
  const firstPageSize = useFirstPageSize(document);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const { currentPage, commitPage } = useCurrentPage(pageCount, initialPage, onPageChange);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [searchOpen, setSearchOpen] = useState(searchTerm !== "");
  const [term, setTerm] = useState(searchTerm);
  const [matchIndex, setMatchIndex] = useState(0);
  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;

  const pageTexts = usePageTexts(document, searchOpen && term.trim() !== "");
  const matches = useMemo(
    () => (pageTexts === null || term.trim() === "" ? [] : findMatches(pageTexts, term)),
    [pageTexts, term],
  );
  const activeMatch = matches[Math.min(matchIndex, Math.max(0, matches.length - 1))];

  const goToPage = useCallback(
    (page: number) => {
      const target = clampPage(page, pageCount);
      commitPage(target);
      pageSlotFor(scrollerRef.current, target)?.scrollIntoView({ block: "start" });
    },
    [pageCount, commitPage],
  );

  useVisiblePageTracking(scrollerRef, commitPage);

  const activePage = activeMatch?.page;
  // matchIndex and term are passed only so the effect refires when stepping between matches on one page or changing the term.
  const jumpToMatch = useEffectEvent(
    (target: {
      readonly page: number | undefined;
      readonly matchIndex: number;
      readonly term: string;
    }) => {
      if (target.page !== undefined) goToPage(target.page);
    },
  );
  useEffect(() => {
    jumpToMatch({ page: activePage, matchIndex, term });
  }, [activePage, matchIndex, term]);

  useEffect(() => {
    if (initialPage > 1)
      pageSlotFor(scrollerRef.current, initialPage)?.scrollIntoView({ block: "start" });
  }, [initialPage]);

  const stepMatch = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    setMatchIndex((index) => (index + direction + matches.length) % matches.length);
  };

  const highlightTerm = searchOpen ? term.trim() : "";
  return (
    <div
      data-testid="pdf-viewer"
      className="flex h-full min-h-[480px] overflow-hidden rounded-md border border-border"
    >
      <PdfThumbnails
        document={document}
        firstPageSize={firstPageSize}
        currentPage={currentPage}
        onSelect={goToPage}
      />
      <div className="flex min-w-0 grow flex-col bg-sender-frame">
        <PdfViewerToolbar
          currentPage={currentPage}
          pageCount={pageCount}
          onGoToPage={goToPage}
          zoom={zoom}
          onZoomOut={() => setZoomIndex((index) => Math.max(0, index - 1))}
          onZoomIn={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))}
          search={{
            open: searchOpen,
            term,
            matchCount: matches.length,
            matchIndex: Math.min(matchIndex, Math.max(0, matches.length - 1)),
          }}
          onToggleSearch={() => setSearchOpen((open) => !open)}
          onTermChange={(next) => {
            setTerm(next);
            setMatchIndex(0);
          }}
          onStepMatch={stepMatch}
        />
        <div ref={scrollerRef} className="min-h-0 grow overflow-auto p-5">
          <div className="mx-auto flex w-max min-w-full flex-col gap-3">
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
              <PdfPageSlot
                key={pageNumber}
                document={document}
                pageNumber={pageNumber}
                firstPageSize={firstPageSize}
                layout={{
                  variant: "viewer",
                  zoom,
                  highlight:
                    highlightTerm === ""
                      ? null
                      : {
                          term: highlightTerm,
                          activeOrdinal:
                            activeMatch?.page === pageNumber ? activeMatch.ordinalOnPage : null,
                        },
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
