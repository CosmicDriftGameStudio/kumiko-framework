// Turns a document-pdf request into the HTML + Chromium options the
// puppeteer-service prints. Everything the page needs (images, fonts-free CSS)
// is embedded here: the service performs no network fetches at all.

import { sanitizePdfAttachmentFileName } from "@cosmicdrift/kumiko-bundled-features/delivery";
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
  addressParagraphCss,
  collectDocumentImageVariables,
  collectDocumentResourceKeys,
  compileDocumentBodyToHandlebars,
  createTemplateResolverApi,
  DEFAULT_PDF_LAYOUT_SLUG,
  DOCUMENT_LINE_VARIABLE,
  documentLinePt,
  flattenAddressSenderLine,
  flattenFramesForPreview,
  isResourceImageContentType,
  type LayoutRegions,
  PARAGRAPH_DEFAULT_LINE_HEIGHT,
  PDF_DEFAULT_FONT_SIZE_PT,
  type PdfLayoutMeta,
  type PdfTemplateMeta,
  prepareDocumentForPrint,
  readLayoutRegions,
  readPdfLayoutMeta,
  readPdfTemplateMeta,
  readTemplateResourceMaxBytes,
  readTopLevelFrames,
  resolveDefaultPdfLayout,
  resolveTemplateVariables,
  sanitizeDocumentHtml,
  sanitizeLayoutHtml,
  TemplateNotFoundError,
  type TemplateResolverApi,
  type TemplateResource,
  toResourceDataUri,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { SYSTEM_TENANT_ID, type TemplateVariables } from "@cosmicdrift/kumiko-framework/engine";
import {
  collectRegionResourceKeys,
  compileDocumentSource,
  createDocumentHandlebars,
  mergeResourceFileRefs,
  readBrandingAccentColor,
  readDocumentFormat,
  readTenantName,
  resolveResourceFileRefs,
} from "@cosmicdrift/kumiko-renderer-mail-html";
import {
  chromiumRegionHtml,
  flowSpacerHtml,
  layoutAppearanceCss,
  type PageMarginsMm,
  planFirstPage,
  resolvePageMargins,
  TEXT_ALIGN_CSS_RULES,
} from "./document-pdf-style.ts";
import { readCompanyData } from "./document-tenant-config.ts";

export type DocumentPdfRequest = {
  readonly html: string;
  readonly options: PdfOptions;
  readonly fileName: string;
  readonly template: RenderedTemplateRef;
  readonly layout: RenderedTemplateRef | null;
};

const LINE_BREAKS = /[\r\n]+/g;
const IMAGE_CONTENT_TYPE_PREFIX = "image/";
const MAX_RECORD_IMAGES = 24;
const MAX_RECORD_IMAGE_LOOKUPS = 100;
const MAX_RECORD_IMAGES_TOTAL_BYTES = 20 * 1024 * 1024;
const PREVIEW_PAGE_NUMBER = "1";
const EMPTY_CHROMIUM_REGION = "<span></span>";
const PAGE_NUMBER_HTML = '<span class="pageNumber"></span>';
const TOTAL_PAGES_HTML = '<span class="totalPages"></span>';

export const PRINT_CSS = [
  `body{font-family:Helvetica,Arial,sans-serif;font-size:${PDF_DEFAULT_FONT_SIZE_PT}pt;line-height:${PARAGRAPH_DEFAULT_LINE_HEIGHT};color:#222;margin:0;${DOCUMENT_LINE_VARIABLE}:${documentLinePt(PDF_DEFAULT_FONT_SIZE_PT)}pt}`,
  `p,table,ul,ol{margin:0 0 var(${DOCUMENT_LINE_VARIABLE})}`,
  `h1,h2,h3{margin:0 0 var(${DOCUMENT_LINE_VARIABLE})}`,
  "td p,th p,li p{margin:0}",
  "td>:last-child,th>:last-child,li>:last-child,.kumiko-frame>:last-child,body>:last-child{margin-bottom:0}",
  "table{width:100%;border-collapse:collapse}",
  "th,td{padding:4px 6px;text-align:left;vertical-align:top}",
  "tr>:first-child{padding-left:0}",
  "tr>:last-child{padding-right:0}",
  "thead{display:table-header-group}",
  "tr{page-break-inside:avoid;break-inside:avoid}",
  "[data-page-break]{page-break-before:always;break-before:page}",
  ...TEXT_ALIGN_CSS_RULES,
  "[data-size=small]{font-size:8pt;color:#555}",
  "img{max-width:100%}",
  ".kumiko-frame p{white-space:pre-line}",
  `.kumiko-frame[data-frame-preset=address]>p{${addressParagraphCss(false)}}`,
  ".kumiko-doc-images{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0}",
  ".kumiko-doc-images:empty{display:none}",
  ".kumiko-doc-images img{width:100%;break-inside:avoid;page-break-inside:avoid}",
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
  alreadyResolved: TemplateResource | null = null,
): Promise<PdfLayout & { readonly ref: RenderedTemplateRef | null }> {
  try {
    let layout =
      alreadyResolved ??
      (await tplApi.resolveLayout({
        tenantId: ctx.tenantId,
        slug,
        kind: "pdf-layout",
        locale,
      }));
    let html = layout.content;
    if (layout.scope !== "system") {
      const sanitized = sanitizeLayoutHtml(html);
      if (sanitized.ok) {
        html = sanitized.html;
      } else {
        layout = await tplApi.resolveLayout({
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

function fileRefIdsOf(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

type RecordImage = { readonly dataUri: string; readonly size: number };

// Own tenant only (no system files): the ids come from the app's record, so a foreign or
// unreadable id drops silently like a missing image instead of failing the document.
async function readRecordImage(
  ctx: RendererContext,
  filesForTenant: NonNullable<RendererContext["filesForTenant"]>,
  fileRefId: string,
  maxBytes: number,
): Promise<RecordImage | null> {
  try {
    const found = await readFileRefContent({
      db: ctx.db,
      filesForTenant,
      fileRefId,
      allowedTenantIds: [ctx.tenantId],
      maxBytes,
    });
    if (found === null || !isResourceImageContentType(found.contentType)) return null;
    return { dataUri: toResourceDataUri(found.contentType, found.content), size: found.size };
  } catch (e) {
    if (e instanceof FileRefTooLargeError) return null;
    throw e;
  }
}

async function loadRecordImageDataUris(
  ctx: RendererContext,
  variables: Readonly<Record<string, unknown>>,
  imageVariableNames: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const dataUrisByVariable = new Map<string, readonly string[]>();
  const { filesForTenant } = ctx;
  if (filesForTenant === undefined || imageVariableNames.length === 0) return dataUrisByVariable;
  const maxBytes = await readTemplateResourceMaxBytes(ctx.config, ctx.registry);
  const seenIds = new Set<string>();
  let loadedCount = 0;
  let loadedBytes = 0;
  for (const name of imageVariableNames) {
    const dataUris: string[] = [];
    for (const fileRefId of fileRefIdsOf(variables[name])) {
      if (seenIds.has(fileRefId)) continue;
      if (seenIds.size >= MAX_RECORD_IMAGE_LOOKUPS) break;
      seenIds.add(fileRefId);
      if (loadedCount >= MAX_RECORD_IMAGES || loadedBytes >= MAX_RECORD_IMAGES_TOTAL_BYTES) break;
      const image = await readRecordImage(
        ctx,
        filesForTenant,
        fileRefId,
        Math.min(maxBytes, MAX_RECORD_IMAGES_TOTAL_BYTES - loadedBytes),
      );
      if (image === null) continue;
      loadedCount += 1;
      loadedBytes += image.size;
      dataUris.push(image.dataUri);
    }
    dataUrisByVariable.set(name, dataUris);
  }
  return dataUrisByVariable;
}

function isImagesVariable(definitions: TemplateVariables, name: string): boolean {
  return Object.hasOwn(definitions, name) && definitions[name]?.type === "images";
}

// An images variable's value is file ids, which no placeholder, title or file name pattern
// may print; the text context carries only whether images exist, so a condition on it works.
function imagesAsPresenceFlags(
  variables: Readonly<Record<string, unknown>>,
  definitions: TemplateVariables,
  recordImages: RecordImages,
  recordImageUris: ReadonlyMap<string, readonly string[]>,
): Record<string, unknown> {
  const hasImages = (name: string): boolean => {
    if (recordImages === "placeholder") return true;
    const resolved = recordImageUris.get(name);
    return resolved !== undefined ? resolved.length > 0 : fileRefIdsOf(variables[name]).length > 0;
  };
  return Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [
      name,
      isImagesVariable(definitions, name) ? hasImages(name) : value,
    ]),
  );
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

function renderChromiumRegion(args: {
  readonly regionHtml: string;
  readonly position: "header" | "footer";
  readonly margins: PageMarginsMm;
  readonly layoutMeta: PdfLayoutMeta;
}): string {
  if (args.regionHtml.trim() === "") return EMPTY_CHROMIUM_REGION;
  return chromiumRegionHtml({
    regionHtml: args.regionHtml,
    position: args.position,
    marginLeftMm: args.margins.left,
    marginRightMm: args.margins.right,
    layoutMeta: args.layoutMeta,
  });
}

// Chromium prints the same header and footer on every page, so a letterhead that
// differs on the first page is not possible.
function frameDocument(args: {
  readonly locale: string;
  readonly title: string;
  readonly bodyHtml: string;
  readonly signatureHtml: string;
  readonly extraCss: string;
  readonly leadingHtml: string;
}): string {
  const signatureBlockHtml =
    args.signatureHtml === "" ? "" : `<div class="kumiko-signature">${args.signatureHtml}</div>`;
  // html-ok: extraCss is layoutAppearanceCss and planFirstPage output, built only from enum stacks, #rrggbb colors and numbers
  return `<!DOCTYPE html><html lang="${escapeHtml(args.locale)}"><head><meta charset="utf-8"><title>${escapeHtml(args.title)}</title><style>${PRINT_CSS}${args.extraCss}</style></head><body>${args.leadingHtml}${args.bodyHtml}${signatureBlockHtml}</body></html>`;
}

function resolveOptions(meta: PdfTemplateMeta | null, margins: PageMarginsMm): PdfOptions {
  return {
    format: meta?.pageFormat ?? "A4",
    printBackground: meta?.printBackground ?? true,
    ...(meta?.orientation === "landscape" && { landscape: true }),
    marginMm: margins,
  };
}

type DocumentInput = {
  readonly slug: string;
  readonly locale: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly draft?: DocumentPdfDraft;
  /** Whose row the draft edits: a SystemAdmin edits the system row, everyone else the tenant's own. */
  readonly draftScope?: "system" | "tenant";
};

type PageMarkers = "chromium" | "preview";

// Only the server render path resolves the record's images. Preview and draft paths take
// variables a TenantAdmin can choose, so they must not read files by those ids.
type RecordImages = "resolve" | "placeholder";

type AssembledDocument = {
  readonly template: TemplateResource;
  readonly layout: PdfLayout & { readonly ref: RenderedTemplateRef | null };
  readonly layoutSlug: string;
  readonly meta: PdfTemplateMeta | null;
  readonly layoutMeta: PdfLayoutMeta;
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
// Images come from the caller's own row of this slug and locale whatever its status: a
// tenant that only saved a draft has no active row, yet its draft already links the logo.
function applyPdfDraft(
  stored: TemplateResource | null,
  own: TemplateResource | null,
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
  const base: TemplateResource = stored ??
    own ?? {
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
    linkedResources: { ...(own ?? stored ?? base).linkedResources },
    scope: (own ?? base).scope,
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

async function findOwnPdfTemplate(
  tplApi: TemplateResolverApi,
  ctx: RendererContext,
  slug: string,
  locale: string,
  scope: "system" | "tenant",
): Promise<TemplateResource | null> {
  return tplApi.findExact({
    tenantId: ctx.tenantId,
    slug,
    kind: "document-pdf",
    locale,
    ...(scope === "system" && { scope }),
  });
}

async function assembleDocument(
  input: DocumentInput,
  ctx: RendererContext,
  markers: PageMarkers,
  recordImages: RecordImages = "placeholder",
): Promise<AssembledDocument> {
  const { slug, locale, variables } = input;
  const tplApi = createTemplateResolverApi(ctx.db, ctx.registry);
  const template =
    input.draft === undefined
      ? await resolvePdfTemplate(tplApi, ctx, slug, locale)
      : applyPdfDraft(
          await findStoredPdfTemplate(tplApi, ctx, slug, locale),
          await findOwnPdfTemplate(tplApi, ctx, slug, locale, input.draftScope ?? "tenant"),
          input.draft,
          slug,
          locale,
        );
  const meta = readPdfTemplateMeta(template.meta);
  const defaultLayout =
    meta?.layoutSlug === undefined
      ? await resolveDefaultPdfLayout(ctx, ctx.tenantId, locale)
      : null;
  const layoutSlug = meta?.layoutSlug ?? defaultLayout?.slug ?? DEFAULT_PDF_LAYOUT_SLUG;
  const layout = await resolvePdfLayout(
    tplApi,
    ctx,
    layoutSlug,
    locale,
    defaultLayout?.resolved ?? null,
  );
  const layoutMeta = readPdfLayoutMeta(layout.template?.meta ?? null);

  try {
    const [format, tenantName, accentColor, companyData] = await Promise.all([
      readDocumentFormat(ctx, locale),
      readTenantName(ctx),
      readBrandingAccentColor(ctx),
      readCompanyData(ctx),
    ]);
    const hbs = createDocumentHandlebars(format);
    const variableDefinitions = resolveTemplateVariables(
      ctx.registry,
      slug,
      template.variableSchema,
    );
    const recordImageUris =
      recordImages === "resolve"
        ? await loadRecordImageDataUris(
            ctx,
            variables,
            collectDocumentImageVariables(template.content).filter((name) =>
              isImagesVariable(variableDefinitions, name),
            ),
          )
        : new Map<string, readonly string[]>();
    const context = {
      ...imagesAsPresenceFlags(variables, variableDefinitions, recordImages, recordImageUris),
      tenantName,
      ...companyData,
      signature: "",
      imprint: "",
      page: "",
      pages: "",
    };

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

    const bodySource = compileDocumentBodyToHandlebars(template.content, variableDefinitions, {
      resourceSrc,
      recordImagesSrc: (variable) => recordImageUris.get(variable) ?? [],
      recordImagesPlaceholder: recordImages === "placeholder",
      ...(accentColor !== undefined && { stepsColor: accentColor }),
    });
    const printableBodyHtml = prepareDocumentForPrint(
      compileDocumentSource(hbs, bodySource)(context),
    );
    const bodyHtml =
      markers === "preview" ? flattenFramesForPreview(printableBodyHtml) : printableBodyHtml;
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
    const fileName = sanitizePdfAttachmentFileName(
      meta?.fileName === undefined ? "" : renderLine(meta.fileName),
      slug,
    );
    return {
      template,
      layout,
      layoutSlug,
      meta,
      layoutMeta,
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
  return toPdfRequest(
    await assembleDocument(req.payload, ctx, "chromium", "resolve"),
    req.payload.locale,
  );
}

// Prints an unsaved draft; the stored template of the slug only supplies images and the variable schema.
export async function buildDocumentDraftPdfRequest(
  req: DocumentPreviewRequest & {
    readonly draft: DocumentPdfDraft;
    readonly draftScope?: "system" | "tenant";
  },
  ctx: RendererContext,
): Promise<DocumentPdfRequest> {
  return toPdfRequest(await assembleDocument(req, ctx, "chromium"), req.locale);
}

function toPdfRequest(document: AssembledDocument, locale: string): DocumentPdfRequest {
  const showLayoutRegions = document.meta?.layoutHeaderFooter !== false;
  const hasHeader = showLayoutRegions && document.headerHtml.trim() !== "";
  const hasFooter = showLayoutRegions && document.footerHtml.trim() !== "";
  const margins = resolvePageMargins(document.meta, document.layoutMeta, hasHeader, hasFooter);
  const firstPage = planFirstPage(
    readTopLevelFrames(document.template.content),
    margins.top,
    margins.left,
  );
  const options = resolveOptions(document.meta, { ...margins, left: firstPage.pageLeftMm });
  const regionArgs = { margins, layoutMeta: document.layoutMeta };
  return {
    html: frameDocument({
      locale,
      title: document.title,
      bodyHtml: flattenAddressSenderLine(document.bodyHtml),
      signatureHtml: document.signatureHtml,
      extraCss: layoutAppearanceCss(document.layoutMeta) + firstPage.css,
      leadingHtml: flowSpacerHtml(firstPage),
    }),
    options:
      hasHeader || hasFooter
        ? {
            ...options,
            displayHeaderFooter: true,
            headerTemplate: renderChromiumRegion({
              ...regionArgs,
              regionHtml: document.headerHtml,
              position: "header",
            }),
            footerTemplate: renderChromiumRegion({
              ...regionArgs,
              regionHtml: document.footerHtml,
              position: "footer",
            }),
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
