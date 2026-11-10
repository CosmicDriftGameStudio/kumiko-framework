// PDF to PNG through poppler (pdftoppm for pages, pdfimages for embedded images). Both run as
// argument-array child processes in a private temp dir, never through a shell. The files go
// through Bun.file/Bun.write because the repo lint bans node:fs for anything near request data.

import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod";

export const RASTER_DPI_OPTIONS = [72, 100, 150] as const;
export const DEFAULT_RASTER_DPI = 100;
export const MAX_EMBEDDED_IMAGES = 20;
export const MAX_RASTER_RESPONSE_BYTES = 20_000_000;
// A small PDF can embed a huge image; pdfimages would decode it to a PNG of that size before any byte limit applies.
export const MAX_EMBEDDED_IMAGE_PIXELS = 25_000_000;

const PDF_MAGIC = "%PDF-";
const A4_LONG_SIDE_INCH = 297 / 25.4;
// Model providers refuse larger images; an embedded image above this is skipped instead of failing the whole call.
const MAX_EMBEDDED_IMAGE_BYTES = 5_000_000;
const PNG_IHDR_WIDTH_OFFSET = 16;

export const rasterizeRequestSchema = z.object({
  pdfBase64: z.string().min(1),
  maxPages: z.number().int().positive().optional(),
  dpi: z.literal(RASTER_DPI_OPTIONS).optional(),
  images: z.boolean().optional(),
});

export type RasterizeRequest = z.infer<typeof rasterizeRequestSchema>;

export type RasterImage = {
  readonly mimeType: "image/png";
  readonly data: string;
  readonly widthPx: number;
  readonly heightPx: number;
};

export type RasterizeResult = {
  readonly pages: readonly RasterImage[];
  readonly images: readonly RasterImage[];
};

export type RasterizeOptions = {
  readonly pdfBytes: Uint8Array;
  readonly maxPages: number;
  readonly dpi: number;
  readonly images: boolean;
  readonly timeoutMs: number;
};

export class InvalidPdfError extends Error {}
export class RasterizeTimeoutError extends Error {}
export class RasterResultTooLargeError extends Error {
  constructor(readonly gotBytes: number) {
    super(`rasterized result of ${gotBytes} bytes exceeds ${MAX_RASTER_RESPONSE_BYTES}`);
  }
}

// pdfimages -list prints a table whose columns 4 and 5 are width and height; header and rule lines are not numeric.
const LIST_WIDTH_COLUMN = 3;
const LIST_HEIGHT_COLUMN = 4;

export function hasOversizedImage(listOutput: string): boolean {
  return listOutput.split("\n").some((line) => {
    const columns = line.trim().split(/\s+/);
    const width = Number(columns[LIST_WIDTH_COLUMN]);
    const height = Number(columns[LIST_HEIGHT_COLUMN]);
    return Number.isFinite(width) && Number.isFinite(height) && width * height > MAX_EMBEDDED_IMAGE_PIXELS;
  });
}

async function runPoppler(
  args: readonly string[],
  deadline: number,
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const timeoutMs = deadline - Date.now();
  if (timeoutMs <= 0) throw new RasterizeTimeoutError(`${args[0]} had no time left`);
  const child = Bun.spawn([...args], { stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (timedOut) throw new RasterizeTimeoutError(`${args[0]} exceeded its time budget`);
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

async function readPngs(
  dir: string,
  prefix: string,
  limits: { readonly count: number; readonly fileBytes: number },
): Promise<RasterImage[]> {
  const names = (await Array.fromAsync(new Bun.Glob(`${prefix}-*.png`).scan(dir))).sort();
  const result: RasterImage[] = [];
  for (const name of names) {
    if (result.length >= limits.count) break;
    const file = Bun.file(join(dir, name));
    if (file.size > limits.fileBytes) continue;
    const bytes = Buffer.from(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    result.push({
      mimeType: "image/png",
      data: bytes.toString("base64"),
      widthPx: view.getUint32(PNG_IHDR_WIDTH_OFFSET),
      heightPx: view.getUint32(PNG_IHDR_WIDTH_OFFSET + 4),
    });
  }
  return result;
}

export async function rasterize(options: RasterizeOptions): Promise<RasterizeResult> {
  const { pdfBytes, maxPages, dpi, images, timeoutMs } = options;
  if (new TextDecoder().decode(pdfBytes.subarray(0, PDF_MAGIC.length)) !== PDF_MAGIC) {
    throw new InvalidPdfError("not a PDF");
  }
  const deadline = Date.now() + timeoutMs;
  const dir = join(tmpdir(), `kumiko-rasterize-${crypto.randomUUID()}`);
  try {
    const pdfPath = join(dir, "input.pdf");
    await Bun.write(pdfPath, pdfBytes);
    const lastPage = String(maxPages);
    const pagesRun = await runPoppler(
      // -scale-to bounds the long side to A4 at the requested dpi, so an oversized page cannot blow up the PNG.
      [
        "pdftoppm",
        "-png",
        "-scale-to",
        String(Math.round(A4_LONG_SIDE_INCH * dpi)),
        "-f",
        "1",
        "-l",
        lastPage,
        pdfPath,
        join(dir, "page"),
      ],
      deadline,
    );
    if (pagesRun.exitCode !== 0) throw new InvalidPdfError(pagesRun.stderr.trim() || "pdftoppm failed");
    let extractImages = images;
    if (extractImages) {
      const listRun = await runPoppler(["pdfimages", "-list", "-l", lastPage, pdfPath], deadline);
      if (listRun.exitCode !== 0) {
        throw new InvalidPdfError(listRun.stderr.trim() || "pdfimages failed");
      }
      extractImages = !hasOversizedImage(listRun.stdout);
    }
    if (extractImages) {
      const imagesRun = await runPoppler(
        ["pdfimages", "-png", "-l", lastPage, pdfPath, join(dir, "image")],
        deadline,
      );
      if (imagesRun.exitCode !== 0) {
        throw new InvalidPdfError(imagesRun.stderr.trim() || "pdfimages failed");
      }
    }
    const pages = await readPngs(dir, "page", {
      count: maxPages,
      fileBytes: MAX_RASTER_RESPONSE_BYTES,
    });
    const embedded = extractImages
      ? await readPngs(dir, "image", {
          count: MAX_EMBEDDED_IMAGES,
          fileBytes: MAX_EMBEDDED_IMAGE_BYTES,
        })
      : [];
    const totalBytes = [...pages, ...embedded].reduce((sum, image) => sum + image.data.length, 0);
    if (totalBytes > MAX_RASTER_RESPONSE_BYTES) throw new RasterResultTooLargeError(totalBytes);
    return { pages, images: embedded };
  } finally {
    await Bun.spawn(["rm", "-rf", dir]).exited;
  }
}
