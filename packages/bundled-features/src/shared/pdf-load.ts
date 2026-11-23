import { AsyncLocalStorage } from "node:async_hooks";
import {
  decodePDFRawStream,
  type LoadOptions,
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFObject,
  PDFXRefStreamParser,
} from "pdf-lib";

// Caps the buffer occupancy of the stream decoders per load (ObjStm and XRef). Buffers grow in powers of two, so
// the decoders need more than 16 MiB of buffer from about 8 MiB of decoded data on. A legitimate PDF with 2000 pages
// takes about 5 MiB of buffer. Decoded tokens cost about 20x in heap, so the worst case stays below what an
// uncompressed file at the read limit already costs today.
export const MAX_PDF_DECODE_BUFFER_BYTES = 16 * 1024 * 1024;

// Counts every visit, not only the first one per node: a tree that lists a page twice still loads, while a cycle
// or a fan-out of shared kids runs into the cap instead of multiplying page objects in the copy.
export const MAX_PDF_PAGE_TREE_NODES = 20_000;

export class PdfDecodeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfDecodeLimitError";
  }
}

function bufferLimitError(budget: DecodeBudget): PdfDecodeLimitError {
  return new PdfDecodeLimitError(
    `pdf stream decoders need ${budget.allocatedBytes} bytes of buffer, more than the limit of ${MAX_PDF_DECODE_BUFFER_BYTES}`,
  );
}

type DecodeBudget = { allocatedBytes: number; failure: PdfDecodeLimitError | undefined };

const decodeBudget = new AsyncLocalStorage<DecodeBudget>();

// Last known byteLength per decoder instance; pdf-lib starts every decoder with an empty shared buffer.
const knownBufferBytes = new WeakMap<object, number>();

type EnsureBuffer = (this: object, requested: number) => Uint8Array;
type DecodeBufferHost = { ensureBuffer: EnsureBuffer };

function isDecodeBufferHost(value: unknown): value is DecodeBufferHost {
  return (
    typeof value === "object" &&
    value !== null &&
    "ensureBuffer" in value &&
    typeof value.ensureBuffer === "function"
  );
}

type XRefStreamShape = {
  subsections: readonly { length: number }[];
  byteWidths: readonly number[];
  bytes: { length: number };
};

// pdf-lib keeps these fields private; the guard reads them at runtime and fails closed when they are gone.
function isXRefStreamShape(value: unknown): value is XRefStreamShape {
  return (
    typeof value === "object" &&
    value !== null &&
    "subsections" in value &&
    Array.isArray(value.subsections) &&
    "byteWidths" in value &&
    Array.isArray(value.byteWidths) &&
    "bytes" in value &&
    typeof value.bytes === "object" &&
    value.bytes !== null &&
    "length" in value.bytes &&
    typeof value.bytes.length === "number"
  );
}

function installXRefEntryLimit(): void {
  const original: unknown = PDFXRefStreamParser.prototype.parseIntoContext;
  if (typeof original !== "function") {
    throw new Error(
      "pdf-lib no longer exposes PDFXRefStreamParser.parseIntoContext; the PDF decode budget cannot be installed",
    );
  }
  const parseIntoContext = PDFXRefStreamParser.prototype.parseIntoContext;
  PDFXRefStreamParser.prototype.parseIntoContext = function (this: PDFXRefStreamParser) {
    const budget = decodeBudget.getStore();
    if (budget !== undefined) assertXRefEntriesFitStream(this, budget);
    return parseIntoContext.call(this);
  };
}

// Takes the parser as unknown: its fields are declared private, so narrowing the typed `this` yields `never` under tsc.
function assertXRefEntriesFitStream(parser: unknown, budget: DecodeBudget): void {
  if (!isXRefStreamShape(parser)) {
    throw new Error(
      "pdf-lib changed the PDFXRefStreamParser fields; the PDF decode budget cannot check it",
    );
  }
  // /Size and /Index are free numbers: the entry array is sized by them, not by the bytes the stream holds.
  const declared = parser.subsections.reduce((sum, section) => sum + section.length, 0);
  const bytesPerEntry = Math.max(
    1,
    parser.byteWidths.reduce((sum, width) => sum + width, 0),
  );
  const possible = Math.floor(parser.bytes.length / bytesPerEntry);
  if (!(declared <= possible)) {
    budget.failure = new PdfDecodeLimitError(
      `xref stream declares ${declared} entries but holds at most ${possible}`,
    );
    throw budget.failure;
  }
}

let hookInstalled = false;

function installDecodeBudgetHook(): void {
  if (hookInstalled) return;
  // DecodeStream is not exported; the prototype comes from a live instance of the same "pdf-lib" import
  // as PDFDocument, so there is no deep import and no second cjs/es copy. Every pdf-lib filter grows through this one method.
  const decoder: unknown = decodePDFRawStream(PDFContext.create().flateStream(new Uint8Array(0)));
  const decoderPrototype: unknown =
    decoder === null || typeof decoder !== "object"
      ? undefined
      : Object.getPrototypeOf(Object.getPrototypeOf(decoder));
  if (!isDecodeBufferHost(decoderPrototype)) {
    throw new Error(
      "pdf-lib no longer exposes DecodeStream.ensureBuffer; the PDF decode budget cannot be installed",
    );
  }
  const original = decoderPrototype.ensureBuffer;
  decoderPrototype.ensureBuffer = function (this: object, requested: number): Uint8Array {
    // Without an active scope the behavior stays unchanged, so app code using pdf-lib is not affected.
    const budget = decodeBudget.getStore();
    if (budget === undefined) return original.call(this, requested);
    if (budget.failure !== undefined) throw budget.failure;
    const buffer = original.call(this, requested);
    // Counts the real occupancy, not `requested`, which undercuts the power-of-two allocation by up to 2x.
    // The one buffer that crosses the budget is at most twice as large; pdf-lib requests in blocks only.
    const known = knownBufferBytes.get(this) ?? 0;
    if (buffer.byteLength > known) {
      budget.allocatedBytes += buffer.byteLength - known;
      knownBufferBytes.set(this, buffer.byteLength);
    }
    if (budget.allocatedBytes > MAX_PDF_DECODE_BUFFER_BYTES) {
      budget.failure = bufferLimitError(budget);
      throw budget.failure;
    }
    return buffer;
  };
  installXRefEntryLimit();
  // No marker on the prototype: two copies of bundled-features in one process both wrap, each with its own storage.
  hookInstalled = true;
}

function assertPageTreeWithinLimit(doc: PDFDocument): void {
  const root = doc.catalog.lookup(PDFName.of("Pages"));
  const stack: PDFObject[] = root === undefined ? [] : [root];
  let visits = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    visits++;
    if (visits > MAX_PDF_PAGE_TREE_NODES) {
      throw new PdfDecodeLimitError(
        `pdf page tree has more than ${MAX_PDF_PAGE_TREE_NODES} nodes, or lists nodes in a loop`,
      );
    }
    if (!(node instanceof PDFDict)) continue;
    const kids = node.lookup(PDFName.of("Kids"));
    if (!(kids instanceof PDFArray)) continue;
    for (let index = 0; index < kids.size(); index++) {
      const kid = doc.context.lookup(kids.get(index));
      if (kid !== undefined) stack.push(kid);
    }
  }
}

export async function loadPdfWithinDecodeBudget(
  bytes: Uint8Array,
  options?: LoadOptions,
): Promise<PDFDocument> {
  installDecodeBudgetHook();
  const budget: DecodeBudget = { allocatedBytes: 0, failure: undefined };
  const doc = await decodeBudget.run(budget, () => PDFDocument.load(bytes, options));
  // pdf-lib swallows errors while parsing an indirect object and loads on, so the throw only stops the decoding
  // and this flag fails the load. throwOnInvalidObject stays off: it would also refuse slightly broken PDFs that load today.
  if (budget.failure !== undefined) throw budget.failure;
  // The page tree is walked here because copyPages and getPages recurse over shared or cyclic kids without a bound.
  assertPageTreeWithinLimit(doc);
  return doc;
}
