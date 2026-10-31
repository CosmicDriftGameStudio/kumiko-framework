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
import { cn } from "../lib/cn.ts";
import { pageTextItemsFor } from "./pdf-document.ts";
import { PdfPageSlot, type PdfTextHighlight, useFirstPageSize } from "./pdf-page.tsx";
import {
  clampPage,
  findMatches,
  mostVisiblePage,
  type PdfMatch,
  type PdfMatchInfo,
} from "./pdf-search.ts";
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

/** Height a whole page may take inside the scroller's padding; undefined unless `enabled`. */
function useScrollerContentHeight(
  scrollerRef: { readonly current: HTMLElement | null },
  enabled: boolean,
): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!enabled || scroller === null) return undefined;
    // Padding is read from the computed style: the root font size, and so p-5, differs per app.
    const measure = () => {
      const style = getComputedStyle(scroller);
      const padding =
        (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
      setHeight(scroller.clientHeight - padding);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => {
      observer.disconnect();
      setHeight(undefined);
    };
  }, [scrollerRef, enabled]);
  return height;
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

type HighlightTerms = { readonly highlight: string; readonly searched: string };

/** A term counts as searched once the search is visible to the reader or driven by the host. */
function highlightTermsOf(input: {
  readonly term: string;
  readonly markTerm: string;
  readonly searchVisible: boolean;
}): HighlightTerms {
  const searched = input.searchVisible ? input.term.trim() : "";
  return { searched, highlight: searched === "" ? input.markTerm.trim() : searched };
}

/** The search term wins over the passage mark; only the searched page with the active hit gets an ordinal. */
function pageHighlightOf(
  pageNumber: number,
  terms: HighlightTerms,
  activeMatch: PdfMatch | undefined,
): PdfTextHighlight | null {
  if (terms.highlight === "") return null;
  const isSearch = terms.searched !== "";
  return {
    term: terms.highlight,
    source: !isSearch,
    activeOrdinal: isSearch && activeMatch?.page === pageNumber ? activeMatch.ordinalOnPage : null,
  };
}

/** Thumbnail rail, toolbar (page jump, zoom, search) and lazily rendered pages on a sand frame;
 *  `pagesOnly` keeps just the pages on the frame. */
export function PdfViewer({
  document,
  searchTerm = "",
  initialPage = 1,
  onPageChange,
  matchIndex: controlledMatchIndex,
  onMatchesChange,
  hideSearchBar = false,
  markTerm = "",
  fill = false,
  pagesOnly = false,
}: {
  readonly document: PDFDocumentProxy;
  readonly searchTerm?: string;
  readonly initialPage?: number;
  readonly onPageChange?: (page: number) => void;
  /** 0-based active match; makes stepping host-controlled (the viewer scrolls to and marks that hit). */
  readonly matchIndex?: number;
  readonly onMatchesChange?: (info: PdfMatchInfo) => void;
  /** Hides the toolbar's search toggle and controls, for hosts that render their own. */
  readonly hideSearchBar?: boolean;
  /** Marks a passage, e.g. the clause a step was read from, without opening the search; the toolbar search stays usable and wins while it has a term. */
  readonly markTerm?: string;
  readonly fill?: boolean;
  /** Only the pages on the frame, without thumbnail rail and toolbar, for hosts that step through the hits themselves. */
  readonly pagesOnly?: boolean;
}): ReactNode {
  const pageCount = document.numPages;
  const firstPageSize = useFirstPageSize(document);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const { currentPage, commitPage } = useCurrentPage(pageCount, initialPage, onPageChange);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [searchOpen, setSearchOpen] = useState(searchTerm !== "");
  const [term, setTerm] = useState(searchTerm);
  const [internalMatchIndex, setMatchIndex] = useState(0);
  const matchIndex = controlledMatchIndex ?? internalMatchIndex;
  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
  const fitHeight = useScrollerContentHeight(scrollerRef, pagesOnly);

  const pageTexts = usePageTexts(document, searchOpen && term.trim() !== "");
  const matches = useMemo(
    () => (pageTexts === null || term.trim() === "" ? [] : findMatches(pageTexts, term)),
    [pageTexts, term],
  );
  const clampedMatchIndex = Math.min(matchIndex, Math.max(0, matches.length - 1));
  const activeMatch = matches[clampedMatchIndex];

  const reportMatches = useEffectEvent((info: PdfMatchInfo) => onMatchesChange?.(info));
  const matchCount = matches.length;
  useEffect(() => {
    reportMatches({ count: matchCount, index: clampedMatchIndex });
  }, [matchCount, clampedMatchIndex]);

  // The opening page keeps its top in view while the layout settles, until the reader goes elsewhere.
  const [leftPage, setLeftPage] = useState<number | null>(null);
  const goToPage = useCallback(
    (page: number) => {
      const target = clampPage(page, pageCount);
      setLeftPage(initialPage);
      commitPage(target);
      pageSlotFor(scrollerRef.current, target)?.scrollIntoView({ block: "start" });
    },
    [pageCount, commitPage, initialPage],
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

  const stepMatch = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    setMatchIndex((index) => (index + direction + matches.length) % matches.length);
  };

  const terms = highlightTermsOf({
    term,
    markTerm,
    searchVisible: searchOpen || hideSearchBar || pagesOnly,
  });
  const anchorPage =
    terms.searched === "" && initialPage > 1 && leftPage !== initialPage
      ? clampPage(initialPage, pageCount)
      : null;
  return (
    <div
      data-testid="pdf-viewer"
      className={cn(
        "flex h-full overflow-hidden rounded-md border border-border",
        fill ? "min-h-0" : "min-h-[480px]",
      )}
    >
      {!pagesOnly && (
        <PdfThumbnails
          document={document}
          firstPageSize={firstPageSize}
          currentPage={currentPage}
          onSelect={goToPage}
        />
      )}
      <div className="flex min-w-0 grow flex-col bg-sender-frame">
        {!pagesOnly && (
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
              matchIndex: clampedMatchIndex,
            }}
            onToggleSearch={() => setSearchOpen((open) => !open)}
            onTermChange={(next) => {
              setTerm(next);
              setMatchIndex(0);
            }}
            onStepMatch={stepMatch}
            hideSearch={hideSearchBar}
          />
        )}
        <div ref={scrollerRef} className="min-h-0 grow overflow-auto p-5">
          <div
            data-testid="pdf-pages"
            // w-max would size the column to the unshrunk page, so the fit-to-width measurement could never be smaller than the page.
            className={cn("mx-auto flex flex-col gap-3", zoom > 1 ? "w-max min-w-full" : "w-full")}
          >
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
              <PdfPageSlot
                key={pageNumber}
                document={document}
                pageNumber={pageNumber}
                firstPageSize={firstPageSize}
                layout={{
                  variant: "viewer",
                  zoom,
                  highlight: pageHighlightOf(pageNumber, terms, activeMatch),
                  anchorTop: pageNumber === anchorPage,
                  ...(fitHeight !== undefined && { fitHeight }),
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
