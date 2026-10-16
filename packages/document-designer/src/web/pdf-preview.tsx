// @runtime client
/// <reference path="./pdfjs-worker.d.ts" />
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { type ReactNode, Suspense, use, useCallback } from "react";

// pdf.js runs in the main thread ("fake worker"): the worker module is bundled
// with the app and handed over through globalThis.pdfjsWorker, so no worker or
// CDN URL is ever fetched (self-hosting and CSP stay intact).

const RENDER_SCALE = 96 / 72;

type LoadedDocument =
  | { readonly ok: true; readonly document: PDFDocumentProxy }
  | { readonly ok: false };

let cachedKey: string | null = null;
let cachedLoad: Promise<LoadedDocument> | null = null;

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function loadDocument(pdfBase64: string): Promise<LoadedDocument> {
  try {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs"),
    ]);
    Object.assign(globalThis, { pdfjsWorker: worker });
    const document = await pdfjs.getDocument({
      data: decodeBase64(pdfBase64),
    }).promise;
    return { ok: true, document };
  } catch {
    return { ok: false };
  }
}

// The promise must be stable across renders for use(); only the latest PDF is kept.
function documentFor(pdfBase64: string): Promise<LoadedDocument> {
  if (cachedKey !== pdfBase64 || cachedLoad === null) {
    cachedKey = pdfBase64;
    cachedLoad = loadDocument(pdfBase64);
  }
  return cachedLoad;
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
  const viewport = page.getViewport({ scale: RENDER_SCALE });

  const mountCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (canvas === null) return;
      const task = page.render({ canvas, viewport });
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
      void import("pdfjs-dist").then(({ TextLayer }) => {
        const textLayer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container,
          viewport,
        });
        layer = textLayer;
        return textLayer.render().catch(() => undefined);
      });
      return () => layer?.cancel();
    },
    [page, viewport],
  );

  return (
    <figure className="m-0 flex flex-col items-center gap-2" data-testid={`pdf-page-${pageNumber}`}>
      <div className="relative w-fit bg-card shadow-md">
        <canvas ref={mountCanvas} width={viewport.width} height={viewport.height} />
        <div
          ref={mountTextLayer}
          className="absolute inset-0 overflow-hidden leading-none [&_span]:absolute [&_span]:origin-top-left [&_span]:cursor-text [&_span]:whitespace-pre [&_span]:text-transparent [&_span::selection]:bg-primary/30"
        />
      </div>
      <figcaption className="text-xs text-muted-foreground">
        {t("documentDesigner.preview.pageOf", { page: pageNumber, pages: document.numPages })}
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

function Pages({ pdfBase64 }: { pdfBase64: string }): ReactNode {
  const t = useTranslation();
  const loaded = use(documentFor(pdfBase64));
  if (!loaded.ok) {
    return <p className="text-sm text-status-bad">{t("documentDesigner.preview.renderFailed")}</p>;
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

export function PdfPreview({ pdfBase64 }: { readonly pdfBase64: string }): ReactNode {
  const t = useTranslation();
  return (
    <div
      className="flex flex-col items-center gap-6 overflow-auto bg-muted p-6"
      data-testid="document-designer-pdf-preview"
    >
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">{t("documentDesigner.preview.loading")}</p>
        }
      >
        <Pages pdfBase64={pdfBase64} />
      </Suspense>
    </div>
  );
}
