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

import { BRANDING_QN } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import {
  type RenderedTemplateRef,
  type RendererContext,
  RendererError,
  type RenderRequest,
  type RenderResponse,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  compileDocumentBodyToHandlebars,
  createTemplateResolverApi,
  isMailTemplateMeta,
  type MailTemplateMeta,
  resolveTemplateVariables,
  TemplateNotFoundError,
  type TemplateResource,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { TenantSettingsConfig } from "@cosmicdrift/kumiko-bundled-features/tenant-settings";
import { TENANT_CURRENCY_CONFIG_KEY } from "@cosmicdrift/kumiko-framework/engine";
import { formatMoney, resolveSafeMoneyLocale } from "@cosmicdrift/kumiko-headless";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import Handlebars from "handlebars";
import { convert as htmlToText } from "html-to-text";
import mjml2html from "mjml";
import { DEFAULT_MAIL_LAYOUT_MJML, DEFAULT_MAIL_LAYOUT_SLUG } from "./default-layout.js";

const FALLBACK_CURRENCY = "EUR";
const SAFE_LINK_PROTOCOL = /^(https?:|mailto:)/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LINE_BREAKS = /[\r\n]+/g;

type MailFormat = { readonly locale: string; readonly currency: string };

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createMailHandlebars(format: MailFormat): typeof Handlebars {
  const hbs = Handlebars.create();
  hbs.registerHelper("money", (value: unknown): string => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return formatMoney(value, format.currency, format.locale);
    }
    if (isPlainRecord(value)) {
      const { amount, currency } = value;
      if (typeof amount === "number" && Number.isFinite(amount) && typeof currency === "string") {
        return formatMoney(amount, currency, format.locale);
      }
    }
    return value === undefined || value === null ? "" : String(value);
  });
  hbs.registerHelper("date", (value: unknown): string => {
    if (typeof value !== "string" && typeof value !== "number") {
      return value === undefined || value === null ? "" : String(value);
    }
    const locale = resolveSafeMoneyLocale(format.locale);
    try {
      // A date-only string has no zone; going through an instant would show the
      // previous day west of UTC.
      if (typeof value === "string" && DATE_ONLY.test(value)) {
        return Temporal.PlainDate.from(value).toLocaleString(locale, { dateStyle: "medium" });
      }
      const instant =
        typeof value === "number"
          ? Temporal.Instant.fromEpochMilliseconds(value)
          : Temporal.Instant.from(value);
      return instant.toLocaleString(locale, { dateStyle: "medium", timeZone: "UTC" });
    } catch {
      return String(value);
    }
  });
  hbs.registerHelper("link", (value: unknown): string =>
    typeof value === "string" && SAFE_LINK_PROTOCOL.test(value.trim()) ? value : "#",
  );
  return hbs;
}

const KNOWN_HELPERS = { each: true, if: true, money: true, date: true, link: true } as const;

function compileSource(
  hbs: typeof Handlebars,
  source: string,
  options: { readonly noEscape?: boolean } = {},
): HandlebarsTemplateDelegate {
  return hbs.compile(source, {
    knownHelpers: KNOWN_HELPERS,
    knownHelpersOnly: true,
    strict: false,
    ...options,
  });
}

// A key only exists in the registry when its feature is mounted; reading an
// unregistered key through the accessor would throw instead of falling back.
async function readConfigText(ctx: RendererContext, key: string): Promise<string | undefined> {
  if (ctx.config === undefined || ctx.registry.getConfigKey(key) === undefined) return undefined;
  const value = await ctx.config(key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

async function readMailFormat(ctx: RendererContext, payloadLocale: string): Promise<MailFormat> {
  const [locale, currency] = await Promise.all([
    readConfigText(ctx, TenantSettingsConfig.locale),
    readConfigText(ctx, TENANT_CURRENCY_CONFIG_KEY),
  ]);
  return { locale: locale ?? payloadLocale, currency: currency ?? FALLBACK_CURRENCY };
}

async function readTenantName(ctx: RendererContext): Promise<string> {
  return (await readConfigText(ctx, BRANDING_QN.title)) ?? "";
}

async function resolveLayout(
  tplApi: ReturnType<typeof createTemplateResolverApi>,
  ctx: RendererContext,
  meta: MailTemplateMeta,
  locale: string,
): Promise<{ readonly content: string; readonly ref: RenderedTemplateRef | null }> {
  try {
    const layout = await tplApi.resolveTemplate({
      tenantId: ctx.tenantId,
      slug: meta.layoutSlug ?? DEFAULT_MAIL_LAYOUT_SLUG,
      kind: "mail-layout",
      locale,
    });
    return {
      content: layout.content,
      ref: { templateId: layout.id, templateVersion: layout.version, scope: layout.scope },
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
    return { content: DEFAULT_MAIL_LAYOUT_MJML, ref: null };
  }
}

async function resolveMailTemplate(
  tplApi: ReturnType<typeof createTemplateResolverApi>,
  ctx: RendererContext,
  slug: string,
  locale: string,
): Promise<{ readonly template: TemplateResource; readonly meta: MailTemplateMeta }> {
  let template: TemplateResource;
  try {
    template = await tplApi.resolveTemplate({ tenantId: ctx.tenantId, slug, kind: "mail", locale });
  } catch (e) {
    if (e instanceof TemplateNotFoundError) {
      throw new RendererError(
        `renderer-mail-html: no mail template "${slug}" for locale "${locale}"`,
        "invalid_payload",
      );
    }
    throw new RendererError(
      `renderer-mail-html: template resolution failed — ${describe(e)}`,
      "other",
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
  const { slug, locale, variables, unsubscribeUrl } = req.payload;

  const tplApi = createTemplateResolverApi(ctx.db);
  const { template, meta } = await resolveMailTemplate(tplApi, ctx, slug, locale);
  const layout = await resolveLayout(tplApi, ctx, meta, locale);

  const [format, tenantName] = await Promise.all([
    readMailFormat(ctx, locale),
    readTenantName(ctx),
  ]);
  const hbs = createMailHandlebars(format);
  const context = {
    ...variables,
    tenantName,
    signature: "",
    imprint: "",
    unsubscribeUrl: unsubscribeUrl ?? "",
  };

  let contentHtml: string;
  try {
    const handlebarsSource = compileDocumentBodyToHandlebars(
      template.content,
      resolveTemplateVariables(ctx.registry, slug, template.variableSchema),
    );
    contentHtml = compileSource(hbs, handlebarsSource)(context);
  } catch (e) {
    throw new RendererError(
      `renderer-mail-html: rendering the body of "${slug}" failed — ${describe(e)}`,
      "other",
    );
  }

  let subject: string;
  let previewText: string | undefined;
  try {
    subject = compileSource(hbs, meta.subject, { noEscape: true })(context).replace(
      LINE_BREAKS,
      "",
    );
    previewText =
      meta.previewText === undefined
        ? undefined
        : compileSource(hbs, meta.previewText, { noEscape: true })(context).replace(
            LINE_BREAKS,
            "",
          );
  } catch (e) {
    throw new RendererError(
      `renderer-mail-html: rendering subject or preview text of "${slug}" failed — ${describe(e)}`,
      "other",
    );
  }

  let mjmlSource: string;
  try {
    mjmlSource = compileSource(
      hbs,
      layout.content,
    )({
      content: contentHtml,
      subject,
      previewText: previewText ?? "",
      tenantName,
      signature: "",
      imprint: "",
      unsubscribeUrl: unsubscribeUrl ?? "",
    });
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
    template: {
      templateId: template.id,
      templateVersion: template.version,
      scope: template.scope,
    },
    ...(layout.ref === null ? {} : { layout: layout.ref }),
  };
}
