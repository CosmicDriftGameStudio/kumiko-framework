// renderer-mail-html pipeline for kind "mail":
//   1. Resolve the mail template (tenant -> system) and its layout
//      (meta.layoutSlug ?? "default", kind mail-layout, fallback to the in-code
//      DEFAULT_MAIL_LAYOUT_MJML).
//   2. compileDocumentBodyToHandlebars turns the sanitized document body into
//      Handlebars source; every author brace is neutralized there, so the only
//      expressions are the ones template-resolver wrote.
//   3. The body renders with HTML escaping on. The result is handed to the
//      layout as data (`{{{content}}}`), never concatenated into layout source.
//   4. mjml -> email HTML, html-to-text -> plain-text alternative.
// Handlebars runs in an isolated instance with a fixed helper set.

import {
  type InlineAttachmentRef,
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
  isMailTemplateMeta,
  type MailTemplateMeta,
  parseTemplateMeta,
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
import { DEFAULT_MAIL_LAYOUT_MJML, DEFAULT_MAIL_LAYOUT_SLUG } from "./default-layout.js";
import {
  collectRegionResourceKeys,
  compileDocumentSource,
  createDocumentHandlebars,
  mergeResourceFileRefs,
  readDocumentFormat,
  readTenantName,
  resolveResourceFileRefs,
} from "./document-kit.js";
import { renderStructuredLayoutMjml } from "./structured-layout.js";

const LINE_BREAKS = /[\r\n]+/g;

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type ResolvedLayout = {
  readonly content: string;
  readonly format: "mjml" | "html";
  readonly ref: RenderedTemplateRef | null;
  readonly template: TemplateResource | null;
};

const IN_CODE_LAYOUT: ResolvedLayout = {
  content: DEFAULT_MAIL_LAYOUT_MJML,
  format: "mjml",
  ref: null,
  template: null,
};

// Only system layouts are trusted as written: a tenant mjml row left over from
// before that rule, or a tenant html row failing the layout sanitizer, is
// replaced by the system layout of the same slug.
async function resolveLayout(
  tplApi: TemplateResolverApi,
  ctx: RendererContext,
  meta: MailTemplateMeta,
  locale: string,
): Promise<ResolvedLayout> {
  const slug = meta.layoutSlug ?? DEFAULT_MAIL_LAYOUT_SLUG;
  try {
    let layout = await tplApi.resolveTemplate({
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
        useSystemLayout = layout.contentFormat === "mjml";
      }
    }
    if (useSystemLayout) {
      layout = await tplApi.resolveTemplate({
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
    return IN_CODE_LAYOUT;
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
      { resourceSrc: (key) => (resourceFileRefs.has(key) ? `cid:${key}` : undefined) },
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

export async function mailHtmlRender(
  req: RenderRequest,
  ctx: RendererContext,
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
  const layout = await resolveLayout(tplApi, ctx, meta, locale);

  const [format, tenantName] = await Promise.all([
    readDocumentFormat(ctx, locale),
    readTenantName(ctx),
  ]);
  const hbs = createDocumentHandlebars(format);
  const context = {
    ...variables,
    tenantName,
    signature: "",
    imprint: "",
    unsubscribeUrl: unsubscribeUrl ?? "",
  };

  const body = await renderMailBody(tplApi, ctx, template, hbs, context);
  const { contentHtml } = body;
  const layoutFileRefs = await resolveLayoutFileRefs(tplApi, ctx, layout);
  const resourceFileRefs = mergeResourceFileRefs(body.resourceFileRefs, layoutFileRefs);
  const attachments: readonly InlineAttachmentRef[] = [...resourceFileRefs].map(
    ([cid, fileRefId]) => ({ kind: "inline", cid, fileRefId }),
  );
  const { subject, previewText } = renderSubjectLines(hbs, meta, slug, context);

  let mjmlSource: string;
  try {
    const layoutContext = {
      subject,
      previewText: previewText ?? "",
      tenantName,
      signature: "",
      imprint: "",
      unsubscribeUrl: unsubscribeUrl ?? "",
    };
    mjmlSource =
      layout.format === "html"
        ? renderStructuredLayoutMjml({
            layoutHtml: layout.content,
            contentHtml,
            context: layoutContext,
            compile: (source) => compileDocumentSource(hbs, source),
            resourceSrc: (key) => (resourceFileRefs.has(key) ? `cid:${key}` : undefined),
          })
        : compileDocumentSource(hbs, layout.content)({ ...layoutContext, content: contentHtml });
  } catch (e) {
    // "other": the caller's payload is fine, the layout template is broken.
    throw new RendererError(
      `renderer-mail-html: Handlebars compile failed for layout — ${describe(e)}`,
      "other",
    );
  }

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

  const text = htmlToText(mjmlResult.html, {
    wordwrap: 80,
    selectors: [
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
      { selector: "img", format: "skip" },
    ],
  });

  return {
    kind: "mail",
    subject,
    html: mjmlResult.html,
    text,
    ...(previewText === undefined ? {} : { previewText }),
    ...(attachments.length > 0 && { attachments }),
    ...(draft === undefined && {
      template: {
        templateId: template.id,
        templateVersion: template.version,
        scope: template.scope,
      },
    }),
    ...(layout.ref === null ? {} : { layout: layout.ref }),
  };
}
