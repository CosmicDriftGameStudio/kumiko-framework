// Render pipeline: HTML → PDF or image via Puppeteer.
//
// **Browser lifecycle:** a single long-running browser per service
// instance. Pages are created and closed per render-call — no page
// pool (page reuse has memory-leak issues on long-lived browsers,
// no OOM risk with fresh-page-per-call).
//
// **Crash recovery:** if `browser.newPage()` throws (browser dead),
// re-launch automatically. Most common cause: chromium process killed
// (OOM from K8s pod limit) — the service pod itself keeps running,
// browser restarts on demand.

import puppeteer, {
  type Browser,
  type ErrorCode,
  type LaunchOptions,
  type PDFOptions,
} from "puppeteer";
import { z } from "zod";
import { isBlockedRequestUrl } from "./egress-guard";

// Browser cache + mutex. Single-thread JS makes the critical section
// trivial: no await runs between the `browser?.connected` check and the
// `launchingPromise = puppeteer.launch(...)` assignment, so there's no race.
//
// Concurrent `getBrowser` calls while a launch is in flight → all get
// back the same launchingPromise (no duplicate launch).
let browser: Browser | null = null;
let launchingPromise: Promise<Browser> | null = null;

export type RenderOptions = {
  readonly timeoutMs: number;
  readonly executablePath?: string;
};

const pdfMarginsSchema = z.object({
  top: z.number().min(0).max(100).optional(),
  right: z.number().min(0).max(100).optional(),
  bottom: z.number().min(0).max(100).optional(),
  left: z.number().min(0).max(100).optional(),
});

const pdfOptionsSchema = z.object({
  format: z.enum(["A4", "Letter"]).optional(),
  marginMm: pdfMarginsSchema.optional(),
  printBackground: z.boolean().optional(),
  headerTemplate: z.string().optional(),
  footerTemplate: z.string().optional(),
  displayHeaderFooter: z.boolean().optional(),
});

const imageOptionsSchema = z.object({
  width: z.number().int().positive().max(4000).optional(),
  height: z.number().int().positive().max(4000).optional(),
  format: z.enum(["png", "jpg"]).optional(),
  quality: z.number().int().min(1).max(100).optional(),
});

// Single source of truth for the render-request contract: the HTTP layer parses
// against this schema, render() consumes the inferred type. Previously the type
// was hand-duplicated here with `readonly` modifiers, forcing an
// `as RenderRequest` cast at the parse site (z.infer doesn't emit `readonly`).
export const renderRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("document-pdf"),
    html: z.string().min(1),
    options: pdfOptionsSchema.optional(),
  }),
  z.object({
    kind: z.literal("image-snapshot"),
    html: z.string().min(1),
    options: imageOptionsSchema.optional(),
  }),
]);

export type RenderRequest = z.infer<typeof renderRequestSchema>;
type PdfRenderRequest = Extract<RenderRequest, { kind: "document-pdf" }>;
type ImageRenderRequest = Extract<RenderRequest, { kind: "image-snapshot" }>;

export type RenderResult = {
  readonly contentType: "application/pdf" | "image/png" | "image/jpeg";
  readonly bytes: Uint8Array;
};

/** Minimal Page surface used by the egress guard (chromium-free unit-testable). */
export type EgressGuardPage = {
  setRequestInterception(value: boolean): Promise<void>;
  on(
    event: "request",
    handler: (interceptedRequest: {
      url(): string;
      abort(errorCode: ErrorCode): Promise<void>;
      continue(): Promise<void>;
    }) => void,
  ): void;
};

// Egress-Guard (enterprise#267): see egress-guard.ts. Extracted so CI can assert the
// wiring without launching Chromium (render.integration.test.ts skips in CI).
export async function attachEgressRequestGuard(page: EgressGuardPage): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (interceptedRequest) => {
    if (isBlockedRequestUrl(interceptedRequest.url())) {
      void interceptedRequest.abort("blockedbyclient");
    } else {
      void interceptedRequest.continue();
    }
  });
}

export async function render(req: RenderRequest, opts: RenderOptions): Promise<RenderResult> {
  const browser = await getBrowser(opts.executablePath);
  const page = await browser.newPage();
  try {
    await attachEgressRequestGuard(page);
    // Template HTML for PDF/screenshot does not need JS; disabling it also
    // closes window.open / targetcreated SSRF vectors (enterprise#272).
    await page.setJavaScriptEnabled(false);
    // setContent accepts only "load"/"domcontentloaded" (puppeteer@25);
    // "networkidle0" exists only for page.goto. For static HTML renders
    // "load" is enough (DOM + all sub-resources done).
    await page.setContent(req.html, { waitUntil: "load", timeout: opts.timeoutMs });
    if (req.kind === "document-pdf") {
      const pdfOptions = mapPdfOptions(req.options);
      const pdfBytes = await page.pdf({ ...pdfOptions, timeout: opts.timeoutMs });
      return { contentType: "application/pdf", bytes: new Uint8Array(pdfBytes) };
    }
    return await renderImage(page, req.options);
  } finally {
    await page.close().catch(() => {
      // Do not escalate page.close failures during cleanup — the real render
      // error (if any) was already thrown before we got here.
    });
  }
}

async function renderImage(
  page: Awaited<ReturnType<Browser["newPage"]>>,
  options: ImageRenderRequest["options"],
): Promise<RenderResult> {
  const width = options?.width ?? 1200;
  const height = options?.height ?? 800;
  const format = options?.format ?? "png";
  await page.setViewport({ width, height });
  const screenshotOptions =
    format === "jpg"
      ? { type: "jpeg" as const, quality: options?.quality ?? 80, fullPage: true }
      : { type: "png" as const, fullPage: true };
  const bytes = await page.screenshot(screenshotOptions);
  return {
    contentType: format === "jpg" ? "image/jpeg" : "image/png",
    bytes: new Uint8Array(bytes),
  };
}

function mapPdfOptions(opts: PdfRenderRequest["options"]): PDFOptions {
  const margin = opts?.marginMm;
  return {
    format: opts?.format ?? "A4",
    printBackground: opts?.printBackground ?? true,
    displayHeaderFooter: opts?.displayHeaderFooter ?? false,
    ...(opts?.headerTemplate !== undefined && { headerTemplate: opts.headerTemplate }),
    ...(opts?.footerTemplate !== undefined && { footerTemplate: opts.footerTemplate }),
    margin: margin
      ? {
          top: `${margin.top ?? 10}mm`,
          right: `${margin.right ?? 10}mm`,
          bottom: `${margin.bottom ?? 10}mm`,
          left: `${margin.left ?? 10}mm`,
        }
      : { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
  };
}

async function getBrowser(executablePath?: string): Promise<Browser> {
  // Fast hot path: cached and alive.
  if (browser?.connected) return browser;

  // Mutex: if a launch is already in flight, piggyback on it instead of
  // launching in parallel. (Single-thread JS: no other call can interleave
  // between the check and the assignment below.)
  if (launchingPromise) return launchingPromise;

  // Close a dead handle (OOM-killed chromium → connected=false) before
  // relaunching, otherwise it leaks the handle plus any surviving subprocess.
  // close() (not disconnect()) kills the process; it rejects on a dead
  // transport → swallow.
  // FIRE-AND-FORGET (void, NO await): no await may run between the
  // launchingPromise check and its assignment (invariant above) — otherwise
  // a concurrent getBrowser would see browser=null + launchingPromise=null
  // and start a duplicate launch (exactly the OOM-recovery path). browser=null
  // synchronously, close async afterward.
  if (browser && !browser.connected) {
    const dead = browser;
    browser = null;
    void dead.close().catch(() => {});
  }

  const launchOptions: LaunchOptions = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", // cgroup limits → tmpfs too small
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--block-new-web-contents", // belt against window.open SSRF (enterprise#272)
    ],
    ...(executablePath !== undefined && { executablePath }),
  };
  launchingPromise = puppeteer.launch(launchOptions);
  try {
    browser = await launchingPromise;
    return browser;
  } finally {
    launchingPromise = null;
  }
}

/** Test-only: expose getBrowser for the CI Chrome-launch smoke (#75/#254). */
export async function getBrowserForSmoke(executablePath?: string): Promise<Browser> {
  return getBrowser(executablePath);
}

export async function shutdownBrowser(): Promise<void> {
  const current = browser ?? (launchingPromise ? await launchingPromise.catch(() => null) : null);
  if (current) {
    await current.close().catch(() => {
      // Browser shutdown during test teardown — ignore errors.
    });
  }
  browser = null;
  launchingPromise = null;
}
