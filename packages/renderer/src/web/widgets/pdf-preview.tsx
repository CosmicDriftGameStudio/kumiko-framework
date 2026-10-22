// @runtime client
/// <reference path="./pdfjs-worker.d.ts" />
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { type ReactNode, Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../i18n.tsx";
import { createBoundedLoadCache } from "./bounded-load-cache.ts";

// pdf.js runs in the main thread ("fake worker"): the worker module is bundled
// with the app and handed over through globalThis.pdfjsWorker, so no worker or
// CDN URL is ever fetched (self-hosting and CSP stay intact).

const RENDER_SCALE = 96 / 72;

type LoadedDocument =
  | {
      readonly ok: true;
      readonly document: PDFDocumentProxy;
      // destroy() lives on the loading task, not on the document proxy.
      readonly loadingTask: PDFDocumentLoadingTask;
    }
  | { readonly ok: false };

const MAX_CACHED_DOCUMENTS = 4;

export type PdfPreviewSource = { readonly base64: string } | { readonly url: string };

const documentCache = createBoundedLoadCache<LoadedDocument>(
  MAX_CACHED_DOCUMENTS,
  (loaded) => {
    if (loaded.ok) void loaded.loadingTask.destroy();
  },
  (loaded) => loaded.ok,
);

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function loadBytes(source: PdfPreviewSource): Promise<Uint8Array> {
  if ("base64" in source) return decodeBase64(source.base64);
  const res = await fetch(source.url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`pdf fetch failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadDocument(source: PdfPreviewSource): Promise<LoadedDocument> {
  try {
    const [pdfjs, worker, data] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs"),
      loadBytes(source),
    ]);
    Object.assign(globalThis, { pdfjsWorker: worker });
    const loadingTask = pdfjs.getDocument({ data });
    return { ok: true, document: await loadingTask.promise, loadingTask };
  } catch {
    return { ok: false };
  }
}

// The promise must be stable across renders for use().
function documentKey(source: PdfPreviewSource): string {
  return "base64" in source ? `base64:${source.base64}` : `url:${source.url}`;
}

function documentFor(source: PdfPreviewSource): Promise<LoadedDocument> {
  return documentCache.load(documentKey(source), () => loadDocument(source));
}

function PageView({
  document,
  pageNumber,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
}): ReactNode {
  const t = useTranslation();
  const page = use(pageFor(document, pageNumber));
  // Stable identity: the mount callbacks below depend on it, and a new viewport per render re-mounts canvas and text layer.
  const viewport = useMemo(() => page.getViewport({ scale: RENDER_SCALE }), [page]);

  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  const measureFrame = useCallback((frame: HTMLDivElement | null) => {
    if (frame === null) return;
    const observer = new ResizeObserver(() => setAvailableWidth(frame.clientWidth));
    observer.observe(frame);
    setAvailableWidth(frame.clientWidth);
    return () => observer.disconnect();
  }, []);
  // The sheet keeps its natural pixel size and is scaled as a whole, so canvas and text layer stay aligned.
  const fitScale =
    availableWidth === null || availableWidth <= 0
      ? 1
      : Math.min(1, availableWidth / viewport.width);

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
      if (container === null) return;
      container.style.setProperty("--total-scale-factor", String(RENDER_SCALE));
      container.style.setProperty("--scale-factor", String(RENDER_SCALE));
      let layer: { cancel: () => void } | null = null;
      let cancelled = false;
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
        return textLayer.render().catch(() => undefined);
      });
      return () => {
        cancelled = true;
        layer?.cancel();
      };
    },
    [page, viewport],
  );

  return (
    <figure
      className="m-0 flex w-full flex-col items-center gap-2 rounded-lg bg-muted p-4"
      data-testid={`pdf-page-${pageNumber}`}
    >
      <div ref={measureFrame} className="w-full">
        <div
          className="mx-auto"
          style={{ width: viewport.width * fitScale, height: viewport.height * fitScale }}
        >
          <div
            className="relative border border-border bg-white shadow-md"
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
              className="absolute inset-0 overflow-hidden leading-none [&_span]:absolute [&_span]:origin-top-left [&_span]:cursor-text [&_span]:whitespace-pre [&_span]:text-transparent [&_span::selection]:bg-primary/30"
            />
          </div>
        </div>
      </div>
      <figcaption className="text-xs text-muted-foreground">
        {t("kumiko.widget.pdf-preview.pageOf", { page: pageNumber, pages: document.numPages })}
      </figcaption>
    </figure>
  );
}

const pageCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<PDFPageProxy>>>();

function pageFor(document: PDFDocumentProxy, pageNumber: number): Promise<PDFPageProxy> {
  let pages = pageCache.get(document);
  if (pages === undefined) {
    pages = new Map();
    pageCache.set(document, pages);
  }
  let page = pages.get(pageNumber);
  if (page === undefined) {
    page = document.getPage(pageNumber);
    pages.set(pageNumber, page);
  }
  return page;
}

function Pages({ source }: { source: PdfPreviewSource }): ReactNode {
  const t = useTranslation();
  const loaded = use(documentFor(source));
  // A mounted preview keeps its document out of the eviction: destroying it blanks its pages.
  const key = documentKey(source);
  useEffect(() => documentCache.retain(key), [key]);
  if (!loaded.ok) {
    return <p className="text-sm text-status-bad">{t("kumiko.widget.pdf-preview.renderFailed")}</p>;
  }
  const pageNumbers = Array.from({ length: loaded.document.numPages }, (_, index) => index + 1);
  return (
    <>
      {pageNumbers.map((pageNumber) => (
        <Suspense key={pageNumber} fallback={null}>
          <PageView document={loaded.document} pageNumber={pageNumber} />
        </Suspense>
      ))}
    </>
  );
}

export function PdfPreview({
  source,
  testId = "pdf-preview",
}: {
  readonly source: PdfPreviewSource;
  readonly testId?: string;
}): ReactNode {
  const t = useTranslation();
  return (
    <div className="flex flex-col items-stretch gap-4 overflow-auto" data-testid={testId}>
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">{t("kumiko.widget.pdf-preview.loading")}</p>
        }
      >
        <Pages source={source} />
      </Suspense>
    </div>
  );
}
