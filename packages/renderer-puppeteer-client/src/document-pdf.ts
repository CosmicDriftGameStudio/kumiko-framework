// Turns a document-pdf request into the HTML + Chromium options the
// puppeteer-service prints. Everything the page needs (images, fonts-free CSS)
// is embedded here: the service performs no network fetches at all.

import {
  FileRefTooLargeError,
  readFileRefContent,
} from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import {
  type DocumentPdfDraft,
  type DocumentPreview,
  type DocumentPreviewRequest,
  type PdfOptions,
  type RenderedTemplateRef,
  type RendererContext,
  RendererError,
  type RenderRequest,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  collectDocumentResourceKeys,
  compileDocumentBodyToHandlebars,
  createTemplateResolverApi,
  DEFAULT_MAIL_LAYOUT_SLUG,
  type LayoutRegions,
  type PdfTemplateMeta,
  prepareDocumentForPrint,
  readLayoutRegions,
  readPdfTemplateMeta,
  readTemplateResourceMaxBytes,
  resolveTemplateVariables,
  sanitizeDocumentHtml,
  sanitizeLayoutHtml,
  TemplateNotFoundError,
  type TemplateResolverApi,
  type TemplateResource,
  toResourceDataUri,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  collectRegionResourceKeys,
  compileDocumentSource,
  createDocumentHandlebars,
  mergeResourceFileRefs,
  readDocumentFormat,
  readTenantName,
  resolveResourceFileRefs,
} from "@cosmicdrift/kumiko-renderer-mail-html";

export type DocumentPdfRequest = {
  readonly html: string;
  readonly options: PdfOptions;
  readonly fileName: string;
  readonly template: RenderedTemplateRef;
  readonly layout: RenderedTemplateRef | null;
};

const LINE_BREAKS = /[\r\n]+/g;
const MAX_FILE_NAME_LENGTH = 200;
const IMAGE_CONTENT_TYPE_PREFIX = "image/";
const DEFAULT_MARGIN_MM = 15;
const HEADER_MARGIN_MM = 30;
const FOOTER_MARGIN_MM = 20;
const PREVIEW_PAGE_NUMBER = "1";
const EMPTY_CHROMIUM_REGION = "<span></span>";
const PAGE_NUMBER_HTML = '<span class="pageNumber"></span>';
const TOTAL_PAGES_HTML = '<span class="totalPages"></span>';

const PRINT_CSS = [
  "body{font-family:Helvetica,Arial,sans-serif;font-size:10.5pt;color:#222;margin:0}",
  "table{width:100%;border-collapse:collapse}",
  "th,td{padding:4px 6px;text-align:left;vertical-align:top}",
  "thead{display:table-header-group}",
  "tr{page-break-inside:avoid;break-inside:avoid}",
  "[data-page-break]{page-break-before:always;break-before:page}",
  "[data-align=left]{text-align:left}",
  "[data-align=center]{text-align:center}",
  "[data-align=right]{text-align:right}",
  "[data-align=justify]{text-align:justify}",
  "img{max-width:100%}",
].join("");

const EMPTY_REGIONS: LayoutRegions = { header: "", signature: "", footer: "" };

type PdfLayout = {
  readonly regions: LayoutRegions;
  readonly template: TemplateResource | null;
};

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripControlCharacters(value: string): string {
  return value
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
}

// The name ends up in a Content-Disposition header or a mail attachment: content-disposition
// (download) and nodemailer (send) apply the RFC 5987 encoding, so only separators and
// control characters have to go here.
export function sanitizePdfFileName(raw: string, slug: string): string {
  const cleaned = stripControlCharacters(raw)
    .replace(/[/\\";]/g, "-")
    .replaceAll("..", "-")
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH)
    .trim();
  if (cleaned === "") return `${slug}.pdf`;
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

async function resolvePdfTemplate(
  tplApi: TemplateResolverApi,
  ctx: RendererContext,
  slug: string,
  locale: string,
): Promise<TemplateResource> {
  let template: TemplateResource;
  try {
    template = await tplApi.resolveTemplate({
      tenantId: ctx.tenantId,
      slug,
      kind: "document-pdf",
      locale,
    });
  } catch (e) {
    if (e instanceof TemplateNotFoundError) {
      throw new RendererError(
        `renderer-puppeteer-client: no document-pdf template "${slug}" for locale "${locale}"`,
        "invalid_payload",
      );
    }
    throw new RendererError(
      `renderer-puppeteer-client: template resolution failed — ${describe(e)}`,
      "other",
    );
  }
  if (template.contentFormat !== "html") {
    throw new RendererError(
      `renderer-puppeteer-client: template "${slug}" has contentFormat "${template.contentFormat}", only html is supported`,
      "invalid_payload",
    );
  }
  return template;
}

// Only system layouts are trusted as written: a tenant row is re-checked on every render
// and replaced by the system layout of the same slug when it fails the layout sanitizer.
async function resolvePdfLayout(
  tplApi: TemplateResolverApi,
  ctx: RendererContext,
  slug: string,
  locale: string,
): Promise<PdfLayout & { readonly ref: RenderedTemplateRef | null }> {
  try {
    let layout = await tplApi.resolveTemplate({
      tenantId: ctx.tenantId,
      slug,
      kind: "pdf-layout",
      locale,
    });
    let html = layout.content;
    if (layout.scope !== "system") {
      const sanitized = sanitizeLayoutHtml(html);
      if (sanitized.ok) {
        html = sanitized.html;
      } else {
        layout = await tplApi.resolveTemplate({
          tenantId: SYSTEM_TENANT_ID,
          slug,
          kind: "pdf-layout",
          locale,
        });
        html = layout.content;
      }
    }
    return {
      regions: readLayoutRegions(html),
      template: layout,
      ref: { templateId: layout.id, templateVersion: layout.version, scope: layout.scope },
    };
  } catch (e) {
    // Only "no layout seeded" falls back to the layout-less default; other failures
    // must not silently strip the letterhead from every document.
    if (!(e instanceof TemplateNotFoundError)) {
      throw new RendererError(
        `renderer-puppeteer-client: layout resolution failed — ${describe(e)}`,
        "other",
      );
    }
    return { regions: EMPTY_REGIONS, template: null, ref: null };
  }
}

async function loadResourceDataUris(
  ctx: RendererContext,
  fileRefIds: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, string>> {
  const { filesForTenant } = ctx;
  const dataUris = new Map<string, string>();
  if (filesForTenant === undefined || fileRefIds.size === 0) return dataUris;
  const maxBytes = await readTemplateResourceMaxBytes(ctx.config, ctx.registry);
  for (const [key, fileRefId] of fileRefIds) {
    let found: Awaited<ReturnType<typeof readFileRefContent>>;
    try {
      found = await readFileRefContent({
        db: ctx.db,
        filesForTenant,
        fileRefId,
        allowedTenantIds: [ctx.tenantId, SYSTEM_TENANT_ID],
        maxBytes,
      });
    } catch (e) {
      // An oversized image drops out like a missing one; the document still renders.
      if (e instanceof FileRefTooLargeError) continue;
      throw e;
    }
    if (found === null || !found.contentType.startsWith(IMAGE_CONTENT_TYPE_PREFIX)) continue;
    dataUris.set(key, toResourceDataUri(found.contentType, found.content));
  }
  return dataUris;
}

type Hbs = ReturnType<typeof createDocumentHandlebars>;

function renderRegion(
  hbs: Hbs,
  region: string,
  context: Readonly<Record<string, unknown>>,
  resourceSrc: (key: string) => string | undefined,
): string {
  if (region.trim() === "") return "";
  const source = compileDocumentBodyToHandlebars(region, {}, { resourceSrc });
  return prepareDocumentForPrint(compileDocumentSource(hbs, source)(context));
}

function renderChromiumRegion(
  regionHtml: string,
  marginLeftMm: number,
  marginRightMm: number,
): string {
  if (regionHtml.trim() === "") return EMPTY_CHROMIUM_REGION;
  return (
    "<style>img{max-height:20mm}</style>" +
    `<div style="width:100%;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif;font-size:9px;color:#333;padding:0 ${marginRightMm}mm 0 ${marginLeftMm}mm;-webkit-print-color-adjust:exact">${regionHtml}</div>`
  );
}

// Chromium prints the same header and footer on every page, so a letterhead that
// differs on the first page is not possible.
function frameDocument(args: {
  readonly locale: string;
  readonly title: string;
  readonly bodyHtml: string;
  readonly signatureHtml: string;
}): string {
  const signatureBlockHtml =
    args.signatureHtml === "" ? "" : `<div class="kumiko-signature">${args.signatureHtml}</div>`;
  return `<!DOCTYPE html><html lang="${escapeHtml(args.locale)}"><head><meta charset="utf-8"><title>${escapeHtml(args.title)}</title><style>${PRINT_CSS}</style></head><body>${args.bodyHtml}${signatureBlockHtml}</body></html>`;
}

function resolveOptions(
  meta: PdfTemplateMeta | null,
  hasHeader: boolean,
  hasFooter: boolean,
): { readonly options: PdfOptions; readonly left: number; readonly right: number } {
  const left = meta?.margins?.left ?? DEFAULT_MARGIN_MM;
  const right = meta?.margins?.right ?? DEFAULT_MARGIN_MM;
  const options: PdfOptions = {
    format: meta?.pageFormat ?? "A4",
    printBackground: meta?.printBackground ?? true,
    ...(meta?.orientation === "landscape" && { landscape: true }),
    marginMm: {
      top: meta?.margins?.top ?? (hasHeader ? HEADER_MARGIN_MM : DEFAULT_MARGIN_MM),
      right,
      bottom: meta?.margins?.bottom ?? (hasFooter ? FOOTER_MARGIN_MM : DEFAULT_MARGIN_MM),
      left,
    },
  };
  return { options, left, right };
}

type DocumentInput = {
  readonly slug: string;
  readonly locale: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly draft?: DocumentPdfDraft;
};

type PageMarkers = "chromium" | "preview";

type AssembledDocument = {
  readonly template: TemplateResource;
  readonly layout: PdfLayout & { readonly ref: RenderedTemplateRef | null };
  readonly layoutSlug: string;
  readonly meta: PdfTemplateMeta | null;
  readonly bodyHtml: string;
  readonly signatureHtml: string;
  readonly headerHtml: string;
  readonly footerHtml: string;
  readonly title: string;
  readonly fileName: string;
  readonly missingResourceKeys: readonly string[];
};

// The draft comes from a caller outside the write pipeline, so it passes the document
// sanitizer and the meta check again instead of being trusted as already gated.
function applyPdfDraft(
  stored: TemplateResource | null,
  draft: DocumentPdfDraft,
  slug: string,
  locale: string,
): TemplateResource {
  const sanitized = sanitizeDocumentHtml(draft.content);
  if (!sanitized.ok) {
    throw new RendererError(
      `renderer-puppeteer-client: draft of "${slug}" violates the document rules (${sanitized.violations.map((v) => v.code).join(", ")})`,
      "invalid_payload",
    );
  }
  const base: TemplateResource = stored ?? {
    id: "",
    version: 0,
    tenantId: "",
    slug,
    kind: "document-pdf",
    locale,
    title: null,
    folder: null,
    content: "",
    contentFormat: "html",
    variableSchema: {},
    linkedResources: {},
    meta: null,
    scope: "tenant",
    parentTemplateId: null,
    status: "draft",
    modifiedAt: null,
  };
  return {
    ...base,
    content: sanitized.html,
    contentFormat: "html",
    meta: draft.meta,
    variableSchema: { ...(draft.variableSchema ?? base.variableSchema) },
  };
}

async function findStoredPdfTemplate(
  tplApi: TemplateResolverApi,
  ctx: RendererContext,
  slug: string,
  locale: string,
): Promise<TemplateResource | null> {
  try {
    return await resolvePdfTemplate(tplApi, ctx, slug, locale);
  } catch (e) {
    if (e instanceof RendererError && e.code === "invalid_payload") return null;
    throw e;
  }
}

async function assembleDocument(
  input: DocumentInput,
  ctx: RendererContext,
  markers: PageMarkers,
): Promise<AssembledDocument> {
  const { slug, locale, variables } = input;
  const tplApi = createTemplateResolverApi(ctx.db);
  const template =
    input.draft === undefined
      ? await resolvePdfTemplate(tplApi, ctx, slug, locale)
      : applyPdfDraft(
          await findStoredPdfTemplate(tplApi, ctx, slug, locale),
          input.draft,
          slug,
          locale,
        );
  const meta = readPdfTemplateMeta(template.meta);
  const layoutSlug = meta?.layoutSlug ?? DEFAULT_MAIL_LAYOUT_SLUG;
  const layout = await resolvePdfLayout(tplApi, ctx, layoutSlug, locale);

  try {
    const [format, tenantName] = await Promise.all([
      readDocumentFormat(ctx, locale),
      readTenantName(ctx),
    ]);
    const hbs = createDocumentHandlebars(format);
    const context = { ...variables, tenantName, signature: "", imprint: "", page: "", pages: "" };

    const bodyKeys = collectDocumentResourceKeys(template.content);
    const layoutKeys = collectRegionResourceKeys(layout.regions);
    const bodyRefs = await resolveResourceFileRefs(tplApi, ctx, template, bodyKeys);
    const layoutRefs =
      layout.template === null
        ? new Map<string, string>()
        : await resolveResourceFileRefs(tplApi, ctx, layout.template, layoutKeys);
    const dataUris = await loadResourceDataUris(ctx, mergeResourceFileRefs(bodyRefs, layoutRefs));
    const resourceSrc = (key: string): string | undefined => dataUris.get(key);
    const missingResourceKeys = [...new Set([...bodyKeys, ...layoutKeys])].filter(
      (key) => !dataUris.has(key),
    );

    const bodySource = compileDocumentBodyToHandlebars(
      template.content,
      resolveTemplateVariables(ctx.registry, slug, template.variableSchema),
      { resourceSrc },
    );
    const bodyHtml = prepareDocumentForPrint(compileDocumentSource(hbs, bodySource)(context));
    const signatureHtml = renderRegion(hbs, layout.regions.signature, context, resourceSrc);

    const pagedContext =
      markers === "chromium"
        ? {
            ...context,
            page: new hbs.SafeString(PAGE_NUMBER_HTML),
            pages: new hbs.SafeString(TOTAL_PAGES_HTML),
          }
        : { ...context, page: PREVIEW_PAGE_NUMBER, pages: PREVIEW_PAGE_NUMBER };
    const headerHtml = renderRegion(hbs, layout.regions.header, pagedContext, resourceSrc);
    const footerHtml = renderRegion(hbs, layout.regions.footer, pagedContext, resourceSrc);

    const renderLine = (pattern: string): string =>
      compileDocumentSource(hbs, pattern, { noEscape: true })(context).replace(LINE_BREAKS, "");
    const title = meta?.metadata?.title === undefined ? slug : renderLine(meta.metadata.title);
    const fileName = sanitizePdfFileName(
      meta?.fileName === undefined ? "" : renderLine(meta.fileName),
      slug,
    );
    return {
      template,
      layout,
      layoutSlug,
      meta,
      bodyHtml,
      signatureHtml,
      headerHtml,
      footerHtml,
      title,
      fileName,
      missingResourceKeys,
    };
  } catch (e) {
    if (e instanceof RendererError) throw e;
    throw new RendererError(
      `renderer-puppeteer-client: rendering "${slug}" failed — ${describe(e)}`,
      "other",
    );
  }
}

export async function buildDocumentPdfRequest(
  req: Extract<RenderRequest, { kind: "document-pdf" }>,
  ctx: RendererContext,
): Promise<DocumentPdfRequest> {
  return toPdfRequest(await assembleDocument(req.payload, ctx, "chromium"), req.payload.locale);
}

// Prints an unsaved draft; the stored template of the slug only supplies images and the variable schema.
export async function buildDocumentDraftPdfRequest(
  req: DocumentPreviewRequest & { readonly draft: DocumentPdfDraft },
  ctx: RendererContext,
): Promise<DocumentPdfRequest> {
  return toPdfRequest(await assembleDocument(req, ctx, "chromium"), req.locale);
}

function toPdfRequest(document: AssembledDocument, locale: string): DocumentPdfRequest {
  const showLayoutRegions = document.meta?.layoutHeaderFooter !== false;
  const hasHeader = showLayoutRegions && document.headerHtml.trim() !== "";
  const hasFooter = showLayoutRegions && document.footerHtml.trim() !== "";
  const { options, left, right } = resolveOptions(document.meta, hasHeader, hasFooter);
  return {
    html: frameDocument({
      locale,
      title: document.title,
      bodyHtml: document.bodyHtml,
      signatureHtml: document.signatureHtml,
    }),
    options:
      hasHeader || hasFooter
        ? {
            ...options,
            displayHeaderFooter: true,
            headerTemplate: renderChromiumRegion(document.headerHtml, left, right),
            footerTemplate: renderChromiumRegion(document.footerHtml, left, right),
          }
        : { ...options, displayHeaderFooter: false },
    fileName: document.fileName,
    template: {
      templateId: document.template.id,
      templateVersion: document.template.version,
      scope: document.template.scope,
    },
    layout: document.layout.ref,
  };
}

// Same rendering as the PDF, stopped before the print service: an editor shows this.
export async function buildDocumentPreview(
  req: DocumentPreviewRequest,
  ctx: RendererContext,
): Promise<DocumentPreview> {
  const document = await assembleDocument(req, ctx, "preview");
  return {
    title: document.title,
    fileName: document.fileName,
    bodyHtml: document.bodyHtml,
    layout:
      document.layout.ref === null
        ? null
        : {
            slug: document.layoutSlug,
            scope: document.layout.ref.scope,
            headerHtml: document.headerHtml,
            signatureHtml: document.signatureHtml,
            footerHtml: document.footerHtml,
          },
    missingResourceKeys: document.missingResourceKeys,
  };
}
