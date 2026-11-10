import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { toKebab } from "@cosmicdrift/kumiko-types/kebab-case";
import { createTemplateResolverApi, TemplateNotFoundError } from "../api.ts";
import { withParsedDocument } from "../document-sanitizer.ts";
import { parseTemplateMeta, readPdfTemplateMeta } from "../template-meta.ts";
import {
  COMPANY_PLACEHOLDERS,
  DEFAULT_PDF_LAYOUT_SLUG,
  DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY,
  FALLBACK_LOCALE,
} from "../web/constants.ts";

const TENANT_CONFIG_PREFIX = "tenant:config:";

export function companyConfigKey(name: string): string {
  return `${TENANT_CONFIG_PREFIX}${toKebab(name)}`;
}

// A key only exists in the registry when its feature is mounted; reading an unregistered key
// through the accessor would throw instead of falling back.
export async function readTenantConfigText(
  ctx: Pick<HandlerContext, "config" | "registry">,
  qualifiedKey: string,
): Promise<string> {
  if (ctx.config === undefined || ctx.registry.getConfigKey(qualifiedKey) === undefined) return "";
  const value = await ctx.config(qualifiedKey);
  return typeof value === "string" ? value : "";
}

type DefaultLayoutContext = Pick<HandlerContext, "config" | "registry"> & {
  readonly db: Parameters<typeof createTemplateResolverApi>[0];
};

// A configured default that no longer resolves (archived or deleted) must not leave documents
// without letterhead, so it falls back to the built-in layout.
export async function defaultPdfLayoutSlug(
  ctx: DefaultLayoutContext,
  tenantId: string,
  locale: string = FALLBACK_LOCALE,
): Promise<string> {
  const slug = await readTenantConfigText(ctx, DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY);
  if (slug === "") return DEFAULT_PDF_LAYOUT_SLUG;
  try {
    await createTemplateResolverApi(ctx.db, ctx.registry).resolveLayout({
      tenantId,
      slug,
      kind: "pdf-layout",
      locale,
    });
    return slug;
  } catch (e) {
    if (e instanceof TemplateNotFoundError) return DEFAULT_PDF_LAYOUT_SLUG;
    throw e;
  }
}

export function isCompanyPlaceholder(name: string): boolean {
  return COMPANY_PLACEHOLDERS.some((candidate) => candidate === name);
}

function companyPlaceholdersIn(html: string): readonly string[] {
  return withParsedDocument(html, (body) => [
    ...Array.from(body.querySelectorAll("span[data-variable]")).flatMap((element) => {
      const name = element.getAttribute("data-variable") ?? "";
      return isCompanyPlaceholder(name) ? [name] : [];
    }),
  ]);
}

// The layout the document is rendered into: its own choice, else the tenant default, else the built-in one.
async function layoutHtmlOf(
  ctx: HandlerContext,
  tenantId: string,
  meta: unknown,
  locale: string | undefined,
): Promise<string> {
  const parsedMeta = parseTemplateMeta("document-pdf", meta);
  const pdfMeta = parsedMeta.ok ? readPdfTemplateMeta(parsedMeta.meta) : null;
  const effectiveLocale = locale ?? FALLBACK_LOCALE;
  const slug = pdfMeta?.layoutSlug ?? (await defaultPdfLayoutSlug(ctx, tenantId, effectiveLocale));
  try {
    const layout = await createTemplateResolverApi(ctx.db, ctx.registry).resolveLayout({
      tenantId,
      slug,
      kind: "pdf-layout",
      locale: effectiveLocale,
    });
    return layout.content ?? "";
  } catch (e) {
    if (e instanceof TemplateNotFoundError) return "";
    throw e;
  }
}

// Company placeholders the draft or its layout prints without the tenant having entered a value.
export async function emptyCompanyData(
  ctx: HandlerContext,
  input: {
    readonly kind: string;
    readonly body: string;
    readonly meta: unknown;
    readonly locale: string | undefined;
    readonly tenantId: string;
  },
): Promise<readonly string[]> {
  if (input.kind !== "document-pdf" && input.kind !== "pdf-layout") return [];
  const layoutHtml =
    input.kind === "document-pdf"
      ? await layoutHtmlOf(ctx, input.tenantId, input.meta, input.locale)
      : "";
  const used = new Set([
    ...companyPlaceholdersIn(input.body),
    ...companyPlaceholdersIn(layoutHtml),
  ]);
  const empty: string[] = [];
  for (const name of COMPANY_PLACEHOLDERS) {
    if (!used.has(name)) continue;
    const value = await readTenantConfigText(ctx, companyConfigKey(name));
    if (value.trim() === "") empty.push(name);
  }
  return empty;
}
