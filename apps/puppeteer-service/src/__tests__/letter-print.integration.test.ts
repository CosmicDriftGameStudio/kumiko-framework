// Real Chromium behind a local Bun.serve, the real client in front: proves what the stub-based
// client tests cannot, namely how a full-bleed image, a header that skips page 1 and DIN fold
// marks come out on paper.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDocumentBodyToHandlebars } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import type { PdfOptions } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { countPdfPages } from "@cosmicdrift/kumiko-renderer-puppeteer-client";
import type { ClientConfig } from "../../../../packages/renderer-puppeteer-client/src/config";
import type { DocumentPdfRequest } from "../../../../packages/renderer-puppeteer-client/src/document-pdf";
import { printDocumentPdf } from "../../../../packages/renderer-puppeteer-client/src/document-pdf-print";
import { chromiumRegionHtml } from "../../../../packages/renderer-puppeteer-client/src/document-pdf-style";
import type { ServiceConfig } from "../config";
import { shutdownBrowser } from "../render";
import { createApp } from "../server";

const TOKEN = "letter-print-test-token-0123456789abcdef";
const SERVICE_CONFIG: ServiceConfig = {
  port: 0,
  authToken: TOKEN,
  renderTimeoutMs: 30_000,
  maxHtmlBytes: 1_000_000,
  maxPdfBytes: 5_000_000,
  maxRasterPages: 5,
  maxConcurrentRenders: 4,
  browserIdleTimeoutMs: 300_000,
  puppeteerExecutablePath: undefined,
};

const RED_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="210" height="20" preserveAspectRatio="none"><rect width="210" height="20" fill="#ff0000"/></svg>',
)}`;

const MARGINS = { top: 30, right: 20, bottom: 25, left: 25 };
const THREE_PAGES = [1, 2, 3]
  .map((page) => `<p style="page-break-after:${page === 3 ? "auto" : "always"}">Seite ${page}</p>`)
  .join("");

let server: ReturnType<typeof Bun.serve>;
let client: ClientConfig;
let workDir: string;

beforeAll(async () => {
  server = Bun.serve({ port: 0, fetch: createApp(SERVICE_CONFIG).app.fetch });
  client = {
    serviceUrl: `http://localhost:${server.port}`,
    authToken: TOKEN,
    requestTimeoutMs: 60_000,
    maxRetries: 0,
  };
  workDir = await mkdtemp(join(tmpdir(), "letter-print-"));
});

afterAll(async () => {
  await server.stop(true);
  await shutdownBrowser();
  await rm(workDir, { recursive: true, force: true });
});

function regionOptions(args: { header: string; footer: string }): PdfOptions {
  const region = (regionHtml: string, position: "header" | "footer") =>
    chromiumRegionHtml({
      regionHtml,
      position,
      marginLeftMm: MARGINS.left,
      marginRightMm: MARGINS.right,
      layoutMeta: {},
    });
  return {
    format: "A4",
    marginMm: MARGINS,
    displayHeaderFooter: true,
    headerTemplate: region(args.header, "header"),
    footerTemplate: region(args.footer, "footer"),
    printBackground: true,
  };
}

function request(overrides: Partial<DocumentPdfRequest>): DocumentPdfRequest {
  return {
    html: `<html><body style="margin:0">${THREE_PAGES}</body></html>`,
    options: regionOptions({ header: "", footer: "" }),
    fileName: "letter.pdf",
    template: { templateId: "t", templateVersion: 1, scope: "system" },
    layout: null,
    firstPageOptions: null,
    foldMarks: "none",
    cornerMarks: false,
    paperColor: null,
    ...overrides,
  };
}

async function pageText(pdf: Uint8Array, page: number): Promise<string> {
  const file = join(workDir, `text-${page}-${pdf.byteLength}.pdf`);
  await writeFile(file, pdf);
  const run = Bun.spawn(["pdftotext", "-f", String(page), "-l", String(page), file, "-"], {
    stdout: "pipe",
  });
  return new Response(run.stdout).text();
}

type Raster = { width: number; height: number; pixel: (x: number, y: number) => [number, number, number] };

async function rasterPage(pdf: Uint8Array, page: number, dpi = 50): Promise<Raster> {
  const file = join(workDir, `raster-${page}-${dpi}-${pdf.byteLength}.pdf`);
  await writeFile(file, pdf);
  const root = join(workDir, `raster-${page}-${dpi}-${pdf.byteLength}`);
  const run = Bun.spawn(
    ["pdftoppm", "-r", String(dpi), "-f", String(page), "-l", String(page), "-singlefile", file, root],
    { stderr: "pipe" },
  );
  expect(await run.exited).toBe(0);
  const ppm = new Uint8Array(await Bun.file(`${root}.ppm`).arrayBuffer());
  const header = new TextDecoder().decode(ppm.slice(0, 20)).split(/\s+/);
  const width = Number(header[1]);
  const height = Number(header[2]);
  const dataStart = ppm.length - width * height * 3;
  return {
    width,
    height,
    pixel: (x, y) => {
      const at = dataStart + (y * width + x) * 3;
      return [ppm[at] ?? 0, ppm[at + 1] ?? 0, ppm[at + 2] ?? 0];
    },
  };
}

const isRed = ([r, g, b]: [number, number, number]) => r > 200 && g < 80 && b < 80;
const isMarked = ([r]: [number, number, number]) => r < 200;

describe("full-bleed image in header and footer", () => {
  test("runs from paper edge to paper edge, flush with the top and the bottom", async () => {
    const bleed = `<img data-bleed src="${RED_SVG}">`;
    const pdf = await printDocumentPdf(
      client,
      request({ options: regionOptions({ header: bleed, footer: bleed }) }),
    );
    const page = await rasterPage(pdf, 1);
    // The A4 page is 413.4 x 584.3 px at 50 dpi, so the outermost row and column hold a partial pixel.
    const lastFull = { x: page.width - 2, y: page.height - 2 };
    const last = { x: page.width - 1, y: page.height - 1 };
    for (const y of [0, lastFull.y]) {
      for (const x of [0, Math.floor(last.x / 2), lastFull.x]) expect(isRed(page.pixel(x, y))).toBe(true);
    }
    expect(isRed(page.pixel(Math.floor(last.x / 2), Math.floor(page.height / 2)))).toBe(false);
  });
});

describe("headerOnFirstPage false", () => {
  test("keeps the page count and prints the header text only from page 2", async () => {
    const withHeader = regionOptions({ header: "<p>KOPFZEILE</p>", footer: "" });
    const everywhere = await printDocumentPdf(client, request({ options: withHeader }));
    const fromPageTwo = await printDocumentPdf(
      client,
      request({
        options: withHeader,
        firstPageOptions: regionOptions({ header: "", footer: "" }),
      }),
    );
    expect(countPdfPages(fromPageTwo)).toBe(countPdfPages(everywhere));
    expect(countPdfPages(fromPageTwo)).toBe(3);
    expect(await pageText(everywhere, 1)).toContain("KOPFZEILE");
    expect(await pageText(fromPageTwo, 1)).not.toContain("KOPFZEILE");
    expect(await pageText(fromPageTwo, 1)).toContain("Seite 1");
    expect(await pageText(fromPageTwo, 2)).toContain("KOPFZEILE");
    expect(await pageText(fromPageTwo, 3)).toContain("KOPFZEILE");
  });
});

describe("foldMarks", () => {
  const ratio = (page: Raster, mm: number) => Math.round((mm / 297) * page.height);
  const markAt = (page: Raster, mm: number) => {
    const y = ratio(page, mm);
    return [y - 1, y, y + 1].some((row) => isMarked(page.pixel(1, row)));
  };

  test("din-a draws fold and punch marks on the left edge of every page", async () => {
    const pdf = await printDocumentPdf(client, request({ foldMarks: "din-a" }));
    expect(countPdfPages(pdf)).toBe(3);
    for (const number of [1, 2, 3]) {
      const page = await rasterPage(pdf, number);
      for (const mm of [87, 148.5, 192]) expect(markAt(page, mm)).toBe(true);
      expect(markAt(page, 105)).toBe(false);
      expect(isMarked(page.pixel(Math.floor(page.width / 2), ratio(page, 87)))).toBe(false);
    }
  });

  test("din-b moves the fold marks to 105 and 210 mm", async () => {
    const pdf = await printDocumentPdf(client, request({ foldMarks: "din-b" }));
    const page = await rasterPage(pdf, 1);
    for (const mm of [105, 148.5, 210]) expect(markAt(page, mm)).toBe(true);
    expect(markAt(page, 87)).toBe(false);
  });

  test("none leaves the page edge clean", async () => {
    const pdf = await printDocumentPdf(client, request({}));
    const page = await rasterPage(pdf, 1);
    for (const mm of [87, 148.5, 192]) expect(markAt(page, mm)).toBe(false);
  });
});

describe("cornerMarks", () => {
  const DPI = 150;
  const pxPerMm = DPI / 25.4;
  const anyMarkedIn = (page: Raster, xs: [number, number], ys: [number, number]) => {
    for (let x = Math.floor(xs[0]); x <= Math.ceil(xs[1]); x++) {
      for (let y = Math.floor(ys[0]); y <= Math.ceil(ys[1]); y++) {
        if (isMarked(page.pixel(x, y))) return true;
      }
    }
    return false;
  };

  // Vertex 10 mm from both edges, legs of 5 mm running toward the page centre.
  function legsOf(page: Raster, corner: { x: "left" | "right"; y: "top" | "bottom" }) {
    const edgeX = corner.x === "left" ? 10 * pxPerMm : page.width - 10 * pxPerMm;
    const edgeY = corner.y === "top" ? 10 * pxPerMm : page.height - 10 * pxPerMm;
    const towardX = corner.x === "left" ? 1 : -1;
    const towardY = corner.y === "top" ? 1 : -1;
    const spanX = [edgeX + towardX * 2 * pxPerMm, edgeX + towardX * 4 * pxPerMm].sort((a, b) => a - b);
    const spanY = [edgeY + towardY * 2 * pxPerMm, edgeY + towardY * 4 * pxPerMm].sort((a, b) => a - b);
    return {
      horizontal: anyMarkedIn(page, [spanX[0] ?? 0, spanX[1] ?? 0], [edgeY - 2, edgeY + 2]),
      vertical: anyMarkedIn(page, [edgeX - 2, edgeX + 2], [spanY[0] ?? 0, spanY[1] ?? 0]),
      beyondLeg: anyMarkedIn(
        page,
        [edgeX + towardX * 7 * pxPerMm - 2, edgeX + towardX * 7 * pxPerMm + 2],
        [edgeY - 2, edgeY + 2],
      ),
    };
  }

  test("draws an angle in all four corners of every page", async () => {
    const pdf = await printDocumentPdf(client, request({ cornerMarks: true }));
    expect(countPdfPages(pdf)).toBe(3);
    for (const number of [1, 2, 3]) {
      const page = await rasterPage(pdf, number, DPI);
      for (const y of ["top", "bottom"] as const) {
        for (const x of ["left", "right"] as const) {
          expect(legsOf(page, { x, y })).toEqual({
            horizontal: true,
            vertical: true,
            beyondLeg: false,
          });
        }
      }
    }
  });

  test("without cornerMarks the corners stay clean", async () => {
    const pdf = await printDocumentPdf(client, request({}));
    const page = await rasterPage(pdf, 1, DPI);
    expect(legsOf(page, { x: "left", y: "top" })).toEqual({
      horizontal: false,
      vertical: false,
      beyondLeg: false,
    });
  });
});

describe("paperColor", () => {
  const CREAM: [number, number, number] = [0xf4, 0xf1, 0xe2];
  const closeTo = (actual: [number, number, number], expected: [number, number, number]) =>
    actual.every((channel, index) => Math.abs(channel - (expected[index] ?? 0)) <= 2);

  async function printPage(paperColor: string | null): Promise<Raster> {
    const pdf = await printDocumentPdf(
      client,
      request({
        paperColor,
        options: regionOptions({
          header: '<div style="width:100%;font-size:8px">Kopf</div>',
          footer: '<div style="width:100%;font-size:8px">Fuß</div>',
        }),
      }),
    );
    return rasterPage(pdf, 1);
  }

  test("fills the whole page, margins and the header and footer area included", async () => {
    const page = await printPage("#f4f1e2");
    const pxPerMm = 50 / 25.4;
    const probes = [
      [3, 3],
      [page.width - 3, page.height - 3],
      [Math.round(10 * pxPerMm), Math.round(15 * pxPerMm)],
      [Math.round(100 * pxPerMm), Math.round(150 * pxPerMm)],
      [Math.round(100 * pxPerMm), page.height - Math.round(3 * pxPerMm)],
    ] as const;
    for (const [x, y] of probes) expect(closeTo(page.pixel(x, y), CREAM)).toBe(true);
  });

  test("keeps the printed text visible on top of the fill", async () => {
    const page = await printPage("#f4f1e2");
    let darkPixels = 0;
    for (let y = 0; y < page.height; y++) {
      for (let x = 0; x < page.width; x++) if (page.pixel(x, y)[0] < 128) darkPixels++;
    }
    expect(darkPixels).toBeGreaterThan(0);
  });

  test("without paperColor the page stays white", async () => {
    const page = await printPage(null);
    expect(page.pixel(3, 3)).toEqual([255, 255, 255]);
    expect(page.pixel(Math.round(100 * (50 / 25.4)), Math.round(150 * (50 / 25.4)))).toEqual([
      255, 255, 255,
    ]);
  });
});

describe("table row lines", () => {
  const TABLE = (rowAttributes: string) =>
    `<table style="border-collapse:collapse;width:100%"><tbody><tr ${rowAttributes}><td><p>Erste</p></td><td><p>Zeile</p></td></tr><tr><td><p>Zweite</p></td><td><p>Zeile</p></td></tr></tbody></table>`;

  async function printTable(rowAttributes: string): Promise<Raster> {
    const body = compileDocumentBodyToHandlebars(TABLE(rowAttributes), {});
    const pdf = await printDocumentPdf(
      client,
      request({ html: `<html><body style="margin:0">${body}</body></html>` }),
    );
    return rasterPage(pdf, 1);
  }

  const hasRedPixel = (page: Raster) => {
    for (let y = 0; y < page.height; y++) {
      for (let x = 0; x < page.width; x++) if (isRed(page.pixel(x, y))) return true;
    }
    return false;
  };

  test("a lineBelow prints a rule in its color between the rows", async () => {
    expect(hasRedPixel(await printTable('data-line-below="#ff0000 4"'))).toBe(true);
  });

  test("a row without a line prints no rule", async () => {
    expect(hasRedPixel(await printTable(""))).toBe(false);
  });
});

describe("table row lines around a repeat row", () => {
  const CELLS = "<td><p>a</p></td><td><p>b</p></td>";
  const SOURCE = `<table style="border-collapse:collapse;width:100%"><tbody><tr data-repeat-header="" data-line-below="#ff0000 3">${CELLS}</tr><tr data-each="incomes">${CELLS}</tr><tr data-line-above="#ff0000 3">${CELLS}</tr></tbody></table>`;

  // The Handlebars loop is expanded by hand: three copies of the compiled row.
  function expandEach(compiled: string): string {
    const match = compiled.match(/\{\{#each incomes\}\}(.*?)\{\{\/each\}\}/s);
    if (match === null) throw new Error("compiled table has no each block");
    return compiled.replace(match[0], (match[1] ?? "").repeat(3));
  }

  function redBands(page: Raster): number {
    let bands = 0;
    let inBand = false;
    for (let y = 0; y < page.height; y++) {
      let redInRow = false;
      for (let x = 0; x < page.width && !redInRow; x++) redInRow = isRed(page.pixel(x, y));
      if (redInRow && !inBand) bands++;
      inBand = redInRow;
    }
    return bands;
  }

  test("only the header's lineBelow and the total row's lineAbove print, not one rule per copy", async () => {
    const compiled = compileDocumentBodyToHandlebars(SOURCE, {
      incomes: { type: "list", item: { name: { type: "text" } } },
    });
    const pdf = await printDocumentPdf(
      client,
      request({ html: `<html><body style="margin:0">${expandEach(compiled)}</body></html>` }),
    );
    expect(redBands(await rasterPage(pdf, 1, 100))).toBe(2);
  });
});
