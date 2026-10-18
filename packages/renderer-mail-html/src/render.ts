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
  type MailChromeRequest,
  type MailDraft,
  type MailChrome as MailPageChrome,
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
  isSystemOnlyTemplate,
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
import { convert as htmlToText } from "html-to-text";
import mjml2html from "mjml";
import { DEFAULT_MAIL_LAYOUT_SLUG } from "./default-layout.ts";
import {
  collectRegionResourceKeys,
  compileDocumentSource,
  createDocumentHandlebars,
  LOGO_RESOURCE_KEY,
  mergeResourceFileRefs,
  readBrandingAccentColor,
  readBrandingLogo,
  readBrandingLogoUrl,
  readBrandingSiteUrl,
  readDocumentFormat,
  readTenantName,
  resolveResourceFileRefs,
} from "./document-kit.ts";
import {
  buildRenderedPdfAttachments,
  combineMailAttachments,
  mergeInheritedAttachments,
} from "./mail-attachments.ts";
import {
  brandHeaderHtml,
  DEFAULT_ACCENT_COLOR,
  readMailTone,
  type ToneColors,
  toneColors,
} from "./mail-chrome.ts";
import {
  buildMailBandLinksHtml,
  buildMailFooterHtml,
  layoutLinksToPlaceholder,
  type MailFooter,
  type MailFooterResolver,
  resolvedFooterLink,
  safeFooterUrl,
  webHost,
} from "./mail-footer.ts";
import { mailChromeText } from "./mail-strings.ts";
import { MAIL_IMAGE_MAX_WIDTH_PX, renderStructuredLayoutMjml } from "./structured-layout.ts";

export type MailBrandSuffixResolver = (input: {
  readonly locale: string;
  readonly ctx: RendererContext;
}) => string | null | Promise<string | null>;

export type MailSiteUrlResolver = (input: {
  readonly locale: string;
  readonly ctx: RendererContext;
}) => string | null | Promise<string | null>;

export type MailHtmlRenderOptions = {
  readonly footer?: MailFooterResolver;
  /** Text after the tenant name in the in-code layout's brand row, e.g. "Status". */
  readonly brandSuffix?: MailBrandSuffixResolver;
  /** Site link in the mail band when the tenant's branding has no site URL. */
  readonly siteUrl?: MailSiteUrlResolver;
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
  /** Set for the in-code layout: its header is the brand row built in code. */
  readonly brandHeader?: { readonly hasLogo: boolean };
};

// Without a seeded layout every mail still carries the tenant's branding: accent
// line and button color, and a brand row with the logo (or an initial tile) and the name.
const IN_CODE_LAYOUT_META = {
  accentLine: "branding",
  width: 640,
  outerBackground: "#ecedea",
} as const;

function mailResourceSrc(
  resourceFileRefs: ReadonlyMap<string, string>,
  brandingLogoUrl: string | undefined,
): (key: string) => string | undefined {
  return (key) =>
    resourceFileRefs.has(key)
      ? `cid:${key}`
      : key === LOGO_RESOURCE_KEY
        ? brandingLogoUrl
        : undefined;
}

async function inCodeLayout(ctx: RendererContext): Promise<ResolvedLayout> {
  const logoFileRefId = await readBrandingLogo(ctx);
  return {
    content: "<div data-content></div>",
    format: "html",
    ref: null,
    template: null,
    appearanceMeta: IN_CODE_LAYOUT_META,
    brandHeader: { hasLogo: logoFileRefId !== undefined },
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
    const tenantId = isSystemOnlyTemplate(ctx.registry, slug, "mail")
      ? SYSTEM_TENANT_ID
      : ctx.tenantId;
    return await tplApi.resolveTemplate({ tenantId, slug, kind: "mail", locale });
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
  stepsColor: string,
  brandingLogoUrl: string | undefined,
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
        resourceSrc: mailResourceSrc(resourceFileRefs, brandingLogoUrl),
        resourceImageMaxWidthPx: MAIL_IMAGE_MAX_WIDTH_PX,
        alignmentAsInlineStyle: true,
        buttonAsInlineStyle: true,
        tableAsInlineStyle: true,
        headingAsInlineStyle: true,
        stepsColor,
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

type MailChrome = {
  readonly tone: ToneColors | undefined;
  readonly headerChip: string;
  readonly footerNote: string;
};

// Chip and tone are author-chosen per mail; a chip without a known tone takes the accent tone.
function renderMailChrome(
  hbs: typeof Handlebars,
  meta: MailTemplateMeta,
  slug: string,
  context: Readonly<Record<string, unknown>>,
  brandColor: string | undefined,
): MailChrome {
  const render = (source: string | undefined): string =>
    source === undefined ? "" : renderSubjectLine(hbs, source, context).trim();
  try {
    const headerChip = render(meta.headerChip);
    const tone = readMailTone(render(meta.tone));
    return {
      tone:
        tone === undefined && headerChip === ""
          ? undefined
          : toneColors(tone ?? "accent", brandColor),
      headerChip,
      footerNote: render(meta.footerNote),
    };
  } catch (e) {
    throw new RendererError(
      `renderer-mail-html: rendering chip, tone or footer note of "${slug}" failed — ${describe(e)}`,
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
  readonly brandingLogoUrl: string | undefined;
  readonly layoutContext: Readonly<Record<string, unknown>>;
  readonly footerHtml: string;
  readonly chrome: MailChrome;
  readonly brandHeaderHtml: string | undefined;
  readonly bandLinksHtml: string;
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
          resourceSrc: mailResourceSrc(resourceFileRefs, args.brandingLogoUrl),
          ...(appearance !== undefined && { appearance }),
          ...(accentColor !== undefined && { accentColor }),
          ...(args.chrome.tone !== undefined && { tone: args.chrome.tone }),
          ...(args.brandHeaderHtml !== undefined && { brandHeaderHtml: args.brandHeaderHtml }),
          headerChip: args.chrome.headerChip,
          footerNote: args.chrome.footerNote,
          bandLinksHtml: args.bandLinksHtml,
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
  /** Set only where the layout opted into the branding accent line. */
  readonly accentColor: string | undefined;
  /** The tenant's accent color regardless of the layout; tones and the initial tile use it. */
  readonly brandColor: string | undefined;
};

// Only a structured (html) layout carries appearance; an mjml layout keeps its own look.
async function resolveMailBranding(
  ctx: RendererContext,
  layout: ResolvedLayout,
): Promise<MailBranding> {
  const brandColor = await readBrandingAccentColor(ctx);
  if (layout.format !== "html") {
    return { appearance: undefined, accentColor: undefined, brandColor };
  }
  const accentColor = mailLayoutAppearance(layout.appearanceMeta).accentLine
    ? brandColor
    : undefined;
  return {
    appearance: mailLayoutAppearance(layout.appearanceMeta, accentColor),
    accentColor,
    brandColor,
  };
}

async function resolveBrandSuffix(
  options: MailHtmlRenderOptions,
  ctx: RendererContext,
  locale: string,
): Promise<string> {
  if (options.brandSuffix === undefined) return "";
  try {
    return (await options.brandSuffix({ locale, ctx })) ?? "";
  } catch (e) {
    throw new RendererError(
      `renderer-mail-html: the brand suffix resolver failed — ${describe(e)}`,
      "other",
    );
  }
}

async function resolveMailSiteUrl(
  options: MailHtmlRenderOptions,
  ctx: RendererContext,
  locale: string,
): Promise<string | undefined> {
  const brandingSiteUrl = await readBrandingSiteUrl(ctx);
  if (brandingSiteUrl !== undefined || options.siteUrl === undefined) return brandingSiteUrl;
  try {
    return (await options.siteUrl({ locale, ctx })) ?? undefined;
  } catch (e) {
    throw new RendererError(
      `renderer-mail-html: the site URL resolver failed — ${describe(e)}`,
      "other",
    );
  }
}

type MailFooterParts = { readonly footerHtml: string; readonly bandLinksHtml: string };

// A structured layout shows the site and unsubscribe links inside the card and only the
// platform line below it; an mjml layout gets everything in one line.
function renderFooterParts(args: {
  readonly layout: ResolvedLayout;
  readonly footer: MailFooter | null;
  readonly unsubscribeUrl: string;
  readonly siteUrl: string | undefined;
  readonly locale: string;
}): MailFooterParts {
  const { layout, footer, unsubscribeUrl, locale } = args;
  const structured = layout.format === "html";
  const layoutLinksUnsubscribe =
    structured && layoutLinksToPlaceholder(layout.content, "unsubscribeUrl");
  const footerHtml = buildMailFooterHtml({
    footer,
    unsubscribeUrl: structured ? "" : unsubscribeUrl,
    locale,
    layoutLinksImprint: structured && layoutLinksToPlaceholder(layout.content, "imprint"),
    layoutLinksUnsubscribe,
  });
  return {
    footerHtml,
    bandLinksHtml: structured
      ? buildMailBandLinksHtml({
          siteUrl: args.siteUrl,
          unsubscribeUrl,
          locale,
          layoutLinksUnsubscribe,
        })
      : "",
  };
}

export async function readMailChrome(
  req: MailChromeRequest,
  ctx: RendererContext,
  options: MailHtmlRenderOptions = {},
): Promise<MailPageChrome> {
  const { locale } = req;
  const [tenantName, footer, siteUrl, brandSuffix, logoUrl, accentColor] = await Promise.all([
    readTenantName(ctx),
    resolveMailFooter(options, ctx, locale),
    resolveMailSiteUrl(options, ctx, locale),
    resolveBrandSuffix(options, ctx, locale),
    readBrandingLogoUrl(ctx),
    readBrandingAccentColor(ctx),
  ]);
  const footerText = footer?.text?.trim() ?? "";
  const imprint = resolvedFooterLink(
    footer?.imprint,
    mailChromeText(locale, "mail.footer.imprint"),
  );
  const privacy = resolvedFooterLink(
    footer?.privacy,
    mailChromeText(locale, "mail.footer.privacy"),
  );
  const safeSiteUrl = siteUrl?.trim();
  return {
    tenantName,
    brandSuffix,
    ...(logoUrl !== undefined && { logoUrl }),
    ...(accentColor !== undefined && { accentColor }),
    ...(safeSiteUrl !== undefined && webHost(safeSiteUrl) !== null && { siteUrl: safeSiteUrl }),
    ...(footerText !== "" && { footerText }),
    ...(imprint !== undefined && { imprint }),
    ...(privacy !== undefined && { privacy }),
  };
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
  const [format, tenantName, footer, siteUrl, brandSuffix, brandingLogoUrl] = await Promise.all([
    readDocumentFormat(ctx, locale),
    readTenantName(ctx),
    resolveMailFooter(options, ctx, locale),
    resolveMailSiteUrl(options, ctx, locale),
    resolveBrandSuffix(options, ctx, locale),
    readBrandingLogoUrl(ctx),
  ]);
  const layout = (await resolveLayout(tplApi, ctx, meta, locale)) ?? (await inCodeLayout(ctx));
  const hbs = createDocumentHandlebars(format);
  const systemPlaceholders = {
    tenantName,
    signature: "",
    imprint: safeFooterUrl(footer?.imprint),
    unsubscribeUrl: unsubscribeUrl ?? "",
  };
  const context = { ...variables, ...systemPlaceholders };

  const { appearance, accentColor, brandColor } = await resolveMailBranding(ctx, layout);
  const chrome = renderMailChrome(hbs, meta, slug, context, brandColor);
  const body = await renderMailBody(
    tplApi,
    ctx,
    template,
    hbs,
    context,
    appearance?.buttonStyle,
    chrome.tone?.bar ?? brandColor ?? DEFAULT_ACCENT_COLOR,
    brandingLogoUrl,
  );
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
    brandingLogoUrl,
    layoutContext: {
      ...systemPlaceholders,
      mailSentBy:
        tenantName === ""
          ? ""
          : mailChromeText(locale, "mail.footer.sentBy", { sender: tenantName }),
      lang: locale,
      subject,
      previewText: previewText ?? "",
    },
    chrome,
    brandHeaderHtml:
      layout.brandHeader === undefined
        ? undefined
        : brandHeaderHtml({
            tenantName,
            suffix: brandSuffix,
            logoSrc: layout.brandHeader.hasLogo ? `cid:${LOGO_RESOURCE_KEY}` : brandingLogoUrl,
            accentColor: brandColor ?? DEFAULT_ACCENT_COLOR,
          }),
    ...renderFooterParts({
      layout,
      footer,
      unsubscribeUrl: systemPlaceholders.unsubscribeUrl,
      siteUrl,
      locale,
    }),
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
