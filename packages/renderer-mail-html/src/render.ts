// renderer-mail-html pipeline for kind "mail":
//   1. Resolve the mail template (tenant -> system) and its layout
//      (meta.layoutSlug ?? "default", kind mail-layout, fallback to an in-code
//      structured layout with the branding logo or tenant name as header).
//   2. compileDocumentBodyToHandlebars turns the sanitized document body into
//      Handlebars source; every author brace is neutralized there, so the only
//      expressions are the ones template-resolver wrote.
//   3. The body renders with HTML escaping on. The result is handed to the
//      layout as data (`{{{content}}}`), never concatenated into layout source.
//   4. mjml -> email HTML, html-to-text -> plain-text alternative.
// Handlebars runs in an isolated instance with a fixed helper set.

import {
  type InlineAttachmentRef,
  type MailAttachmentRef,
  type MailDraft,
  type RenderedTemplateRef,
  type RendererContext,
  RendererError,
  type RenderRequest,
  type RenderResponse,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  collectDocumentResourceKeys,
  compileDocumentBodyToHandlebars,
  createTemplateResolverApi,
  fileAttachmentsOf,
  imageLinksOf,
  isMailTemplateMeta,
  type MailLayoutAppearance,
  type MailTemplateMeta,
  mailLayoutAppearance,
  parseTemplateMeta,
  pdfAttachmentLinksOf,
  readLayoutRegions,
  resolveTemplateVariables,
  sanitizeDocumentHtml,
  sanitizeLayoutHtml,
  TemplateNotFoundError,
  type TemplateResolverApi,
  type TemplateResource,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import { convert as htmlToText } from "html-to-text";
import mjml2html from "mjml";
import { DEFAULT_MAIL_LAYOUT_SLUG } from "./default-layout.js";
import {
  collectRegionResourceKeys,
  compileDocumentSource,
  createDocumentHandlebars,
  LOGO_RESOURCE_KEY,
  mergeResourceFileRefs,
  readBrandingAccentColor,
  readBrandingLogo,
  readDocumentFormat,
  readTenantName,
  resolveResourceFileRefs,
} from "./document-kit.js";
import {
  buildRenderedPdfAttachments,
  combineMailAttachments,
  mergeInheritedAttachments,
} from "./mail-attachments.js";
import {
  buildMailFooterHtml,
  layoutLinksToPlaceholder,
  type MailFooter,
  type MailFooterResolver,
  safeFooterUrl,
} from "./mail-footer.js";
import { MAIL_IMAGE_MAX_WIDTH_PX, renderStructuredLayoutMjml } from "./structured-layout.js";

export type MailHtmlRenderOptions = {
  readonly footer?: MailFooterResolver;
};

const LINE_BREAKS = /[\r\n]+/g;

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type ResolvedLayout = {
  readonly content: string;
  readonly format: "mjml" | "html";
  readonly ref: RenderedTemplateRef | null;
  readonly template: TemplateResource | null;
  readonly appearanceMeta: unknown;
  readonly fileRefs?: ReadonlyMap<string, string>;
};

// Without a seeded layout every mail still carries the tenant's branding: accent
// line and button color, and the logo (or the name when there is no logo) on top.
const IN_CODE_LAYOUT_META = { accentLine: "branding" } as const;

async function inCodeLayout(ctx: RendererContext, tenantName: string): Promise<ResolvedLayout> {
  const logoFileRefId = await readBrandingLogo(ctx);
  const header =
    logoFileRefId === undefined
      ? '<p style="font-size:20px;font-weight:600;margin:0"><span data-variable="tenantName"></span></p>'
      : `<p style="margin:0"><img data-resource="${LOGO_RESOURCE_KEY}" alt="${escapeHtmlAttr(tenantName)}"></p>`;
  return {
    content: `<div data-header>${header}</div><div data-content></div>`,
    format: "html",
    ref: null,
    template: null,
    appearanceMeta: IN_CODE_LAYOUT_META,
    fileRefs:
      logoFileRefId === undefined ? new Map() : new Map([[LOGO_RESOURCE_KEY, logoFileRefId]]),
  };
}

// Only system layouts are trusted as written: a tenant mjml row left over from
// before that rule, or a tenant html row failing the layout sanitizer, is
// replaced by the system layout of the same slug.
async function resolveLayout(
  tplApi: TemplateResolverApi,
  ctx: RendererContext,
  meta: MailTemplateMeta,
  locale: string,
): Promise<ResolvedLayout | null> {
  const slug = meta.layoutSlug ?? DEFAULT_MAIL_LAYOUT_SLUG;
  try {
    let layout = await tplApi.resolveLayout({
      tenantId: ctx.tenantId,
      slug,
      kind: "mail-layout",
      locale,
    });
    let content = layout.content;
    let useSystemLayout = false;
    if (layout.scope !== "system") {
      if (layout.contentFormat === "html") {
        // Re-checked on every render: rows written before the write gate existed
        // or through another path must not reach the mail unsanitized.
        const sanitized = sanitizeLayoutHtml(content);
        if (sanitized.ok) content = sanitized.html;
        else useSystemLayout = true;
      } else {
        useSystemLayout = true;
      }
    }
    if (useSystemLayout) {
      layout = await tplApi.resolveLayout({
        tenantId: SYSTEM_TENANT_ID,
        slug,
        kind: "mail-layout",
        locale,
      });
      content = layout.content;
    }
    return {
      content,
      format: layout.contentFormat === "html" ? "html" : "mjml",
      ref: { templateId: layout.id, templateVersion: layout.version, scope: layout.scope },
      template: layout,
      appearanceMeta: layout.meta,
    };
  } catch (e) {
    // Only "no layout seeded" falls back to the in-code layout. Connection or
    // schema errors must not be masked, or every mail silently loses its branding.
    if (!(e instanceof TemplateNotFoundError)) {
      throw new RendererError(
        `renderer-mail-html: layout resolution failed — ${describe(e)}`,
        "other",
      );
    }
    return null;
  }
}

async function findStoredMailTemplate(
  tplApi: ReturnType<typeof createTemplateResolverApi>,
  ctx: RendererContext,
  slug: string,
  locale: string,
): Promise<TemplateResource | null> {
  try {
    return await tplApi.resolveTemplate({ tenantId: ctx.tenantId, slug, kind: "mail", locale });
  } catch (e) {
    if (e instanceof TemplateNotFoundError) return null;
    throw new RendererError(
      `renderer-mail-html: template resolution failed — ${describe(e)}`,
      "other",
    );
  }
}

async function resolveLayoutFileRefs(
  tplApi: TemplateResolverApi,
  ctx: RendererContext,
  layout: ResolvedLayout,
): Promise<ReadonlyMap<string, string>> {
  if (layout.fileRefs !== undefined) return layout.fileRefs;
  if (layout.format !== "html" || layout.template === null) return new Map();
  try {
    return await resolveResourceFileRefs(
      tplApi,
      ctx,
      layout.template,
      collectRegionResourceKeys(readLayoutRegions(layout.content)),
    );
  } catch (e) {
    throw new RendererError(
      `renderer-mail-html: resolving the layout images failed — ${describe(e)}`,
      "other",
    );
  }
}

// The draft comes from a caller outside the write pipeline, so it passes the document
// sanitizer and the meta check again instead of being trusted as already gated.
function applyMailDraft(
  stored: TemplateResource | null,
  draft: MailDraft,
  slug: string,
  locale: string,
): TemplateResource {
  const sanitized = sanitizeDocumentHtml(draft.content);
  if (!sanitized.ok) {
    throw new RendererError(
      `renderer-mail-html: draft of "${slug}" violates the document rules (${sanitized.violations.map((v) => v.code).join(", ")})`,
      "invalid_payload",
    );
  }
  const parsedMeta = parseTemplateMeta("mail", draft.meta);
  if (!parsedMeta.ok || !isMailTemplateMeta(parsedMeta.meta)) {
    throw new RendererError(
      `renderer-mail-html: draft of "${slug}" has no valid mail meta`,
      "invalid_payload",
    );
  }
  const base: TemplateResource = stored ?? {
    id: "",
    version: 0,
    tenantId: "",
    slug,
    kind: "mail",
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
    meta: parsedMeta.meta,
    variableSchema: { ...(draft.variableSchema ?? base.variableSchema) },
    ...(draft.linkedResources !== undefined && {
      linkedResources: imageLinksOf(draft.linkedResources),
      fileAttachments: fileAttachmentsOf(draft.linkedResources),
      pdfAttachmentLinks: pdfAttachmentLinksOf(draft.linkedResources),
    }),
  };
}

async function resolveMailTemplate(
  tplApi: TemplateResolverApi,
  ctx: RendererContext,
  slug: string,
  locale: string,
  draft: MailDraft | undefined,
): Promise<{ readonly template: TemplateResource; readonly meta: MailTemplateMeta }> {
  const stored = await findStoredMailTemplate(tplApi, ctx, slug, locale);
  const template = draft === undefined ? stored : applyMailDraft(stored, draft, slug, locale);
  if (template === null) {
    throw new RendererError(
      `renderer-mail-html: no mail template "${slug}" for locale "${locale}"`,
      "invalid_payload",
    );
  }
  if (template.contentFormat !== "html") {
    throw new RendererError(
      `renderer-mail-html: template "${slug}" has contentFormat "${template.contentFormat}", only html is supported`,
      "other",
    );
  }
  if (!isMailTemplateMeta(template.meta)) {
    throw new RendererError(
      `renderer-mail-html: template "${slug}" has no valid mail meta (subject is required)`,
      "other",
    );
  }
  return { template, meta: template.meta };
}

type MailBody = {
  readonly contentHtml: string;
  readonly resourceFileRefs: ReadonlyMap<string, string>;
};

// Each data-resource image is referenced by cid; the bytes are read at send time, so
// the render result carries only file ref ids.
async function renderMailBody(
  tplApi: TemplateResolverApi,
  ctx: RendererContext,
  template: TemplateResource,
  hbs: typeof Handlebars,
  context: Readonly<Record<string, unknown>>,
  buttonInlineStyle: string | undefined,
): Promise<MailBody> {
  try {
    const resourceFileRefs = await resolveResourceFileRefs(
      tplApi,
      ctx,
      template,
      collectDocumentResourceKeys(template.content),
    );
    const handlebarsSource = compileDocumentBodyToHandlebars(
      template.content,
      resolveTemplateVariables(ctx.registry, template.slug, template.variableSchema),
      {
        resourceSrc: (key) => (resourceFileRefs.has(key) ? `cid:${key}` : undefined),
        resourceImageMaxWidthPx: MAIL_IMAGE_MAX_WIDTH_PX,
        alignmentAsInlineStyle: true,
        buttonAsInlineStyle: true,
        tableAsInlineStyle: true,
        ...(buttonInlineStyle !== undefined && { buttonInlineStyle }),
      },
    );
    return {
      contentHtml: compileDocumentSource(hbs, handlebarsSource)(context),
      resourceFileRefs,
    };
  } catch (e) {
    throw new RendererError(
      `renderer-mail-html: rendering the body of "${template.slug}" failed — ${describe(e)}`,
      "other",
    );
  }
}

function renderSubjectLine(
  hbs: typeof Handlebars,
  source: string,
  context: Readonly<Record<string, unknown>>,
): string {
  return compileDocumentSource(hbs, source, { noEscape: true })(context).replace(LINE_BREAKS, "");
}

function renderFileNamePattern(
  hbs: typeof Handlebars,
  pattern: string,
  slug: string,
  context: Readonly<Record<string, unknown>>,
): string {
  try {
    return renderSubjectLine(hbs, pattern, context);
  } catch (e) {
    throw new RendererError(
      `renderer-mail-html: rendering the attachment file name "${pattern}" of "${slug}" failed — ${describe(e)}`,
      "other",
    );
  }
}

function renderSubjectLines(
  hbs: typeof Handlebars,
  meta: MailTemplateMeta,
  slug: string,
  context: Readonly<Record<string, unknown>>,
): { readonly subject: string; readonly previewText: string | undefined } {
  try {
    return {
      subject: renderSubjectLine(hbs, meta.subject, context),
      previewText:
        meta.previewText === undefined
          ? undefined
          : renderSubjectLine(hbs, meta.previewText, context),
    };
  } catch (e) {
    throw new RendererError(
      `renderer-mail-html: rendering subject or preview text of "${slug}" failed — ${describe(e)}`,
      "other",
    );
  }
}

type InheritedAttachments = Pick<TemplateResource, "fileAttachments" | "pdfAttachmentLinks">;

// Same fallback as for images (resolveResourceFileRefs): a tenant override of a system mail
// keeps the attachments the system mail carries.
async function resolveSystemAttachments(
  tplApi: TemplateResolverApi,
  template: TemplateResource,
): Promise<InheritedAttachments> {
  if (template.scope !== "tenant") return {};
  try {
    const system = await tplApi.resolveTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: template.slug,
      kind: template.kind,
      locale: template.locale,
    });
    return {
      fileAttachments: system.fileAttachments ?? [],
      pdfAttachmentLinks: system.pdfAttachmentLinks ?? [],
    };
  } catch (e) {
    if (e instanceof TemplateNotFoundError) return {};
    throw new RendererError(
      `renderer-mail-html: resolving the system attachments of "${template.slug}" failed — ${describe(e)}`,
      "other",
    );
  }
}

async function assembleMailAttachments(args: {
  readonly tplApi: TemplateResolverApi;
  readonly slug: string;
  readonly template: TemplateResource;
  readonly resourceFileRefs: ReadonlyMap<string, string>;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly locale: string;
  readonly renderFileName: (pattern: string) => string;
}): Promise<readonly MailAttachmentRef[]> {
  const { tplApi, slug, template, resourceFileRefs, variables, locale, renderFileName } = args;
  const inherited = await resolveSystemAttachments(tplApi, template);
  const inlineAttachments: readonly InlineAttachmentRef[] = [...resourceFileRefs].map(
    ([cid, fileRefId]) => ({ kind: "inline", cid, fileRefId }),
  );
  const renderedPdfs = buildRenderedPdfAttachments({
    slug,
    links: mergeInheritedAttachments(
      template.pdfAttachmentLinks ?? [],
      inherited.pdfAttachmentLinks ?? [],
      (link) => link.fileName,
    ),
    variables,
    locale,
    renderFileName,
  });
  return combineMailAttachments(
    slug,
    inlineAttachments,
    mergeInheritedAttachments(
      template.fileAttachments ?? [],
      inherited.fileAttachments ?? [],
      (file) => file.fileName,
    ),
    renderedPdfs,
  );
}

type DocumentHandlebars = ReturnType<typeof createDocumentHandlebars>;

function compileLayoutMjml(args: {
  readonly layout: ResolvedLayout;
  readonly hbs: DocumentHandlebars;
  readonly contentHtml: string;
  readonly appearance: MailLayoutAppearance | undefined;
  readonly accentColor: string | undefined;
  readonly resourceFileRefs: ReadonlyMap<string, string>;
  readonly layoutContext: Readonly<Record<string, unknown>>;
  readonly footerHtml: string;
}): string {
  const { layout, hbs, contentHtml, appearance, accentColor, resourceFileRefs, layoutContext } =
    args;
  try {
    return layout.format === "html"
      ? renderStructuredLayoutMjml({
          layoutHtml: layout.content,
          contentHtml,
          context: layoutContext,
          compile: (source) => compileDocumentSource(hbs, source),
          resourceSrc: (key) => (resourceFileRefs.has(key) ? `cid:${key}` : undefined),
          ...(appearance !== undefined && { appearance }),
          ...(accentColor !== undefined && { accentColor }),
          footerHtml: args.footerHtml,
        })
      : compileDocumentSource(
          hbs,
          layout.content,
        )({
          ...layoutContext,
          content: contentHtml,
          mailFooterHtml: args.footerHtml,
        });
  } catch (e) {
    // "other": the caller's payload is fine, the layout template is broken.
    throw new RendererError(
      `renderer-mail-html: Handlebars compile failed for layout — ${describe(e)}`,
      "other",
    );
  }
}

async function compileMjmlToHtml(mjmlSource: string): Promise<string> {
  // mjml@5 is async
  const mjmlResult = await mjml2html(mjmlSource, { validationLevel: "soft" });
  const errors = mjmlResult.errors ?? [];
  if (errors.length > 0) {
    const firstErrors = errors
      .slice(0, 3)
      .map((e) => `line ${e.line}: ${e.message}`)
      .join("; ");
    throw new RendererError(
      `renderer-mail-html: MJML compile produced ${errors.length} error(s) — ${firstErrors}`,
      "other",
    );
  }
  return mjmlResult.html;
}

function htmlToPlainText(html: string): string {
  return htmlToText(html, {
    wordwrap: 80,
    selectors: [
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
      { selector: "img", format: "skip" },
    ],
  });
}

function buildMailRenderResponse(args: {
  readonly subject: string;
  readonly previewText: string | undefined;
  readonly html: string;
  readonly text: string;
  readonly meta: MailTemplateMeta;
  readonly attachments: readonly MailAttachmentRef[];
  readonly template: TemplateResource;
  readonly layout: ResolvedLayout;
  readonly isDraft: boolean;
}): RenderResponse {
  const { subject, previewText, html, text, meta, attachments, template, layout, isDraft } = args;
  return {
    kind: "mail",
    subject,
    html,
    text,
    ...(previewText === undefined ? {} : { previewText }),
    ...(meta.senderName !== undefined && { fromName: meta.senderName }),
    ...(meta.replyTo !== undefined && { replyTo: meta.replyTo }),
    ...(attachments.length > 0 && { attachments }),
    ...(!isDraft && {
      template: {
        templateId: template.id,
        templateVersion: template.version,
        scope: template.scope,
      },
    }),
    ...(layout.ref === null ? {} : { layout: layout.ref }),
  };
}

async function resolveMailFooter(
  options: MailHtmlRenderOptions,
  ctx: RendererContext,
  locale: string,
): Promise<MailFooter | null> {
  if (options.footer === undefined) return null;
  try {
    return await options.footer({ locale, ctx });
  } catch (e) {
    throw new RendererError(
      `renderer-mail-html: the mail footer resolver failed — ${describe(e)}`,
      "other",
    );
  }
}

type MailBranding = {
  readonly appearance: MailLayoutAppearance | undefined;
  readonly accentColor: string | undefined;
};

// Only a structured (html) layout carries appearance; an mjml layout keeps its own look.
async function resolveMailBranding(
  ctx: RendererContext,
  layout: ResolvedLayout,
): Promise<MailBranding> {
  if (layout.format !== "html") return { appearance: undefined, accentColor: undefined };
  const wantsAccent = mailLayoutAppearance(layout.appearanceMeta).accentLine;
  const accentColor = wantsAccent ? await readBrandingAccentColor(ctx) : undefined;
  return { appearance: mailLayoutAppearance(layout.appearanceMeta, accentColor), accentColor };
}

function renderFooterHtml(
  layout: ResolvedLayout,
  footer: MailFooter | null,
  unsubscribeUrl: string,
  locale: string,
): string {
  const structured = layout.format === "html";
  return buildMailFooterHtml({
    footer,
    unsubscribeUrl,
    locale,
    layoutLinksImprint: structured && layoutLinksToPlaceholder(layout.content, "imprint"),
    layoutLinksUnsubscribe:
      structured && layoutLinksToPlaceholder(layout.content, "unsubscribeUrl"),
  });
}

export async function mailHtmlRender(
  req: RenderRequest,
  ctx: RendererContext,
  options: MailHtmlRenderOptions = {},
): Promise<RenderResponse> {
  if (req.kind !== "mail") {
    // Foundation selects plugins only for matching kinds; defensive guard.
    throw new RendererError(
      `renderer-mail-html supports only kind="mail", got "${req.kind}"`,
      "invalid_payload",
    );
  }
  const { slug, locale, variables, unsubscribeUrl, draft } = req.payload;

  const tplApi = createTemplateResolverApi(ctx.db);
  const { template, meta } = await resolveMailTemplate(tplApi, ctx, slug, locale, draft);
  const [format, tenantName, footer] = await Promise.all([
    readDocumentFormat(ctx, locale),
    readTenantName(ctx),
    resolveMailFooter(options, ctx, locale),
  ]);
  const layout =
    (await resolveLayout(tplApi, ctx, meta, locale)) ?? (await inCodeLayout(ctx, tenantName));
  const hbs = createDocumentHandlebars(format);
  const systemPlaceholders = {
    tenantName,
    signature: "",
    imprint: safeFooterUrl(footer?.imprint),
    unsubscribeUrl: unsubscribeUrl ?? "",
  };
  const context = { ...variables, ...systemPlaceholders };

  const { appearance, accentColor } = await resolveMailBranding(ctx, layout);
  const body = await renderMailBody(tplApi, ctx, template, hbs, context, appearance?.buttonStyle);
  const { contentHtml } = body;
  const layoutFileRefs = await resolveLayoutFileRefs(tplApi, ctx, layout);
  const resourceFileRefs = mergeResourceFileRefs(body.resourceFileRefs, layoutFileRefs);
  const attachments = await assembleMailAttachments({
    tplApi,
    slug,
    template,
    resourceFileRefs,
    variables,
    locale,
    renderFileName: (pattern) => renderFileNamePattern(hbs, pattern, slug, context),
  });
  const { subject, previewText } = renderSubjectLines(hbs, meta, slug, context);

  const mjmlSource = compileLayoutMjml({
    layout,
    hbs,
    contentHtml,
    appearance,
    accentColor,
    resourceFileRefs,
    layoutContext: {
      ...systemPlaceholders,
      lang: locale,
      subject,
      previewText: previewText ?? "",
    },
    footerHtml: renderFooterHtml(layout, footer, systemPlaceholders.unsubscribeUrl, locale),
  });
  const html = await compileMjmlToHtml(mjmlSource);

  return buildMailRenderResponse({
    subject,
    previewText,
    html,
    text: htmlToPlainText(html),
    meta,
    attachments,
    template,
    layout,
    isDraft: draft !== undefined,
  });
}
