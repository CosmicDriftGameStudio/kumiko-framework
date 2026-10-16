import { BRANDING_QN } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import type { RendererContext } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  collectDocumentResourceKeys,
  type LayoutRegions,
  TemplateNotFoundError,
  type TemplateResolverApi,
  type TemplateResource,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { TenantSettingsConfig } from "@cosmicdrift/kumiko-bundled-features/tenant-settings";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  isUuid,
  SYSTEM_TENANT_ID,
  TENANT_CURRENCY_CONFIG_KEY,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { formatMoney, resolveSafeMoneyLocale } from "@cosmicdrift/kumiko-headless";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import Handlebars from "handlebars";

// Handlebars instance, template resolution and resource lookup shared by the
// mail and PDF renderers, so both format money/dates and find images the same way.

const FALLBACK_CURRENCY = "EUR";
const SAFE_LINK_PROTOCOL = /^(https?:|mailto:)/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type DocumentFormat = { readonly locale: string; readonly currency: string };

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createDocumentHandlebars(format: DocumentFormat): typeof Handlebars {
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

export function compileDocumentSource(
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

export async function readDocumentFormat(
  ctx: RendererContext,
  payloadLocale: string,
): Promise<DocumentFormat> {
  const [locale, currency] = await Promise.all([
    readConfigText(ctx, TenantSettingsConfig.locale),
    readConfigText(ctx, TENANT_CURRENCY_CONFIG_KEY),
  ]);
  return { locale: locale ?? payloadLocale, currency: currency ?? FALLBACK_CURRENCY };
}

export async function readTenantName(ctx: RendererContext): Promise<string> {
  return (await readConfigText(ctx, BRANDING_QN.title)) ?? "";
}

const LOGO_RESOURCE_KEY = "logo";

// Lookup order: the template's own link, the system template it overrides, and for
// "logo" the tenant's branding logo. The system lookup is skipped for system templates.
export async function resolveResourceFileRefs(
  tplApi: TemplateResolverApi,
  ctx: RendererContext,
  template: TemplateResource,
  keys: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (keys.length === 0) return new Map();
  let systemLinks: Readonly<Record<string, string>> = {};
  if (template.scope === "tenant") {
    try {
      systemLinks = (
        await tplApi.resolveTemplate({
          tenantId: SYSTEM_TENANT_ID,
          slug: template.slug,
          kind: template.kind,
          locale: template.locale,
        })
      ).linkedResources;
    } catch (e) {
      if (!(e instanceof TemplateNotFoundError)) throw e;
    }
  }
  const brandingLogo = keys.includes(LOGO_RESOURCE_KEY) ? await readBrandingLogo(ctx) : undefined;
  const fileRefIds = new Map<string, string>();
  for (const key of keys) {
    const fileRefId =
      ownLink(template.linkedResources, key) ??
      ownLink(systemLinks, key) ??
      (key === LOGO_RESOURCE_KEY ? brandingLogo : undefined);
    if (fileRefId !== undefined) fileRefIds.set(key, fileRefId);
  }
  return fileRefIds;
}

// The token is a free field of the tenant admin and the send reader also reaches the system
// tenant's files, so only a file of the rendering tenant itself counts.
async function readBrandingLogo(ctx: RendererContext): Promise<string | undefined> {
  const fileRefId = await readConfigText(ctx, BRANDING_QN.logoFile);
  if (fileRefId === undefined || !isUuid(fileRefId)) return undefined;
  const [row] = await selectMany<{ id: string }>(ctx.db, fileRefsTable, {
    id: fileRefId,
    tenantId: ctx.tenantId,
    isDeleted: false,
  });
  return row === undefined ? undefined : fileRefId;
}

function ownLink(links: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.hasOwn(links, key) && links[key] !== "" ? links[key] : undefined;
}

export function collectRegionResourceKeys(regions: LayoutRegions): readonly string[] {
  return collectDocumentResourceKeys([regions.header, regions.signature, regions.footer].join(""));
}

// A cid or data URI per key can point to one file only, so a key the body already
// resolved keeps the body's file even when the layout links another one.
export function mergeResourceFileRefs(
  bodyRefs: ReadonlyMap<string, string>,
  layoutRefs: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  return new Map([...layoutRefs, ...bodyRefs]);
}
