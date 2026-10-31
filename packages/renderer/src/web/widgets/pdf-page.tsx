import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  type ReactNode,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "../../i18n.tsx";
import { cn } from "../lib/cn.ts";
import { pageFor } from "./pdf-document.ts";
import { ACTIVE_HIT_CLASS, markTextLayer } from "./pdf-search.ts";
import { useSeenInViewport } from "./use-in-view.ts";

export const RENDER_SCALE = 96 / 72;

export type PdfTextHighlight = { readonly term: string; readonly activeOrdinal: number | null };

export type PdfPageSize = { readonly width: number; readonly height: number };

/** Natural size of page 1; unrendered placeholders and thumbnails use its aspect ratio. */
export function useFirstPageSize(document: PDFDocumentProxy): PdfPageSize {
  const firstPage = use(pageFor(document, 1));
  return useMemo(() => {
    const { width, height } = firstPage.getViewport({ scale: 1 });
    return { width, height };
  }, [firstPage]);
}

export type PageLayout = {
  readonly variant: "stacked" | "viewer";
  readonly zoom: number;
  readonly highlight: PdfTextHighlight | null;
  /** The page the viewer opened on: its top is brought back into view whenever its size settles, unless a search hit is active. */
  readonly anchorTop?: boolean;
};

// Fit-to-width only shrinks; a zoom above 100% is meant to overflow and scroll.
function fitScaleFor(availableWidth: number | null, contentWidth: number, zoom: number): number {
  if (zoom > 1 || availableWidth === null || availableWidth <= 0) return 1;
  return Math.min(1, availableWidth / contentWidth);
}

function PageSheet({
  document,
  pageNumber,
  availableWidth,
  layout,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  availableWidth: number | null;
  layout: PageLayout;
}): ReactNode {
  const page = use(pageFor(document, pageNumber));
  // Stable identity: the mount callbacks below depend on it, and a new viewport per render re-mounts canvas and text layer.
  const viewport = useMemo(
    () => page.getViewport({ scale: RENDER_SCALE * layout.zoom }),
    [page, layout.zoom],
  );
  const fitScale = fitScaleFor(availableWidth, viewport.width, layout.zoom);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [textLayerReady, setTextLayerReady] = useState(false);

  // The sheet keeps its natural pixel size and is scaled as a whole, so canvas and text layer stay aligned.
  const mountCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (canvas === null) return;
      const pixelRatio = globalThis.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      const task = page.render({
        canvas,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      task.promise.catch(() => undefined);
      return () => task.cancel();
    },
    [page, viewport],
  );

  const mountTextLayer = useCallback(
    (container: HTMLDivElement | null) => {
      textLayerRef.current = container;
      if (container === null) return;
      const scale = RENDER_SCALE * layout.zoom;
      container.style.setProperty("--total-scale-factor", String(scale));
      container.style.setProperty("--scale-factor", String(scale));
      let layer: { cancel: () => void } | null = null;
      let cancelled = false;
      setTextLayerReady(false);
      void import("pdfjs-dist").then(({ TextLayer }) => {
        // skip: cleanup ran before pdfjs finished loading
        if (cancelled) return undefined;
        // TextLayer.cancel() keeps rendered spans; a re-mount must not append a second layer.
        container.replaceChildren();
        const textLayer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container,
          viewport,
        });
        layer = textLayer;
        return textLayer
          .render()
          .then(() => {
            if (!cancelled) setTextLayerReady(true);
          })
          .catch(() => undefined);
      });
      return () => {
        cancelled = true;
        layer?.cancel();
      };
    },
    [page, viewport, layout.zoom],
  );

  const highlightTerm = layout.highlight?.term ?? "";
  const activeOrdinal = layout.highlight?.activeOrdinal ?? null;
  const anchorTop = activeOrdinal === null && layout.anchorTop === true;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = textLayerRef.current;
    if (container === null || !textLayerReady) return;
    markTextLayer(container, highlightTerm, activeOrdinal);
    // Scrolling to the page top is not enough: the hit can sit below the fold, and pages above it change height once rendered.
    if (activeOrdinal !== null) {
      container.querySelector(`.${ACTIVE_HIT_CLASS}`)?.scrollIntoView({ block: "center" });
    } else if (anchorTop) {
      sheetRef.current?.scrollIntoView({ block: "start" });
    }
  }, [highlightTerm, activeOrdinal, anchorTop, textLayerReady]);

  return (
    <div
      ref={sheetRef}
      className="mx-auto"
      style={{ width: viewport.width * fitScale, height: viewport.height * fitScale }}
    >
      <div
        className={cn(
          "relative bg-white",
          layout.variant === "viewer"
            ? "rounded-sheet shadow-sheet"
            : "border border-border shadow-md",
        )}
        style={{
          width: viewport.width,
          height: viewport.height,
          transform: `scale(${fitScale})`,
          transformOrigin: "top left",
        }}
      >
        <canvas
          ref={mountCanvas}
          style={{ width: viewport.width, height: viewport.height }}
          className="block"
        />
        <div
          ref={mountTextLayer}
          className={cn(
            "absolute inset-0 overflow-hidden leading-none [&_span]:absolute [&_span]:origin-top-left [&_span]:cursor-text [&_span]:whitespace-pre [&_span]:text-transparent [&_span::selection]:bg-primary/30",
            // The sheet is always white, so the marker colors are theme-independent; alpha keeps the canvas glyphs readable.
            "[&_mark]:rounded-[2px] [&_mark]:px-px [&_mark]:text-transparent [&_.pdf-hit]:bg-amber-200/70 [&_.pdf-hit-active]:bg-amber-400/80",
          )}
        />
      </div>
    </div>
  );
}

/** One page: a sized placeholder until it nears the viewport, then the rendered sheet. */
export function PdfPageSlot({
  document,
  pageNumber,
  firstPageSize,
  layout,
}: {
  readonly document: PDFDocumentProxy;
  readonly pageNumber: number;
  readonly firstPageSize: PdfPageSize;
  readonly layout: PageLayout;
}): ReactNode {
  const t = useTranslation();
  const { seen, observe } = useSeenInViewport();
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  const slotRef = useRef<HTMLElement | null>(null);
  const anchorTop = layout.anchorTop === true && layout.highlight?.activeOrdinal == null;
  // A jump on mount lands on placeholders that only shrink to the pane width once it is measured; re-anchor then.
  useEffect(() => {
    if (anchorTop && availableWidth !== null) slotRef.current?.scrollIntoView({ block: "start" });
  }, [anchorTop, availableWidth]);
  const mountFrame = useCallback(
    (frame: HTMLDivElement | null) => {
      if (frame === null) return undefined;
      const resizeObserver = new ResizeObserver(() => setAvailableWidth(frame.clientWidth));
      resizeObserver.observe(frame);
      setAvailableWidth(frame.clientWidth);
      const stopObservingView = observe(frame);
      return () => {
        resizeObserver.disconnect();
        stopObservingView?.();
      };
    },
    [observe],
  );

  const scale = RENDER_SCALE * layout.zoom;
  const placeholderWidth = firstPageSize.width * scale;
  const placeholderFit = fitScaleFor(availableWidth, placeholderWidth, layout.zoom);
  const placeholder = (
    <div
      className="mx-auto"
      style={{
        width: placeholderWidth * placeholderFit,
        height: firstPageSize.height * scale * placeholderFit,
      }}
    />
  );

  return (
    <figure
      ref={slotRef}
      data-pdf-page={pageNumber}
      data-testid={`pdf-page-${pageNumber}`}
      className={cn(
        "m-0 flex w-full flex-col items-center gap-2",
        layout.variant === "stacked" && "rounded-lg bg-muted p-4",
      )}
    >
      <div ref={mountFrame} className="w-full">
        {seen ? (
          <Suspense fallback={placeholder}>
            <PageSheet
              document={document}
              pageNumber={pageNumber}
              availableWidth={availableWidth}
              layout={layout}
            />
          </Suspense>
        ) : (
          placeholder
        )}
      </div>
      {layout.variant === "stacked" && (
        <figcaption className="text-xs text-muted-foreground">
          {t("kumiko.widget.pdf-preview.pageOf", { page: pageNumber, pages: document.numPages })}
        </figcaption>
      )}
    </figure>
  );
}
