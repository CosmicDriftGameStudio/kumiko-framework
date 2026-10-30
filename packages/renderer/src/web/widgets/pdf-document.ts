/// <reference path="./pdfjs-worker.d.ts" />
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { createBoundedLoadCache } from "./bounded-load-cache.ts";

// pdf.js runs in the main thread ("fake worker"): the worker module is bundled
// with the app and handed over through globalThis.pdfjsWorker, so no worker or
// CDN URL is ever fetched (self-hosting and CSP stay intact).

export type PdfPreviewSource = { readonly base64: string } | { readonly url: string };

export type LoadedDocument =
  | {
      readonly ok: true;
      readonly document: PDFDocumentProxy;
      // destroy() lives on the loading task, not on the document proxy.
      readonly loadingTask: PDFDocumentLoadingTask;
    }
  | { readonly ok: false };

const MAX_CACHED_DOCUMENTS = 4;

export const documentCache = createBoundedLoadCache<LoadedDocument>(
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

export function documentKey(source: PdfPreviewSource): string {
  return "base64" in source ? `base64:${source.base64}` : `url:${source.url}`;
}

// The promise must be stable across renders for use().
export function documentFor(source: PdfPreviewSource): Promise<LoadedDocument> {
  return documentCache.load(documentKey(source), () => loadDocument(source));
}

const pageCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<PDFPageProxy>>>();

export function pageFor(document: PDFDocumentProxy, pageNumber: number): Promise<PDFPageProxy> {
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

const pageTextCache = new WeakMap<PDFDocumentProxy, Promise<readonly (readonly string[])[]>>();

/** Text items per page (index 0 = page 1), collected once per document. */
export function pageTextItemsFor(
  document: PDFDocumentProxy,
): Promise<readonly (readonly string[])[]> {
  let texts = pageTextCache.get(document);
  if (texts === undefined) {
    texts = Promise.all(
      Array.from({ length: document.numPages }, async (_, index) => {
        const content = await (await pageFor(document, index + 1)).getTextContent();
        return content.items.flatMap((item) => ("str" in item ? [item.str] : []));
      }),
    );
    pageTextCache.set(document, texts);
  }
  return texts;
}
