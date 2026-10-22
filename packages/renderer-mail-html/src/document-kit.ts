import { BRANDING_QN } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { isSafeHttpsUrl } from "@cosmicdrift/kumiko-bundled-features/page-render";
import type { RendererContext } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  collectDocumentResourceKeys,
  flattenParagraphsToLineBreaks,
  isHexColor,
  type LayoutRegions,
  sanitizeDocumentHtml,
  TemplateNotFoundError,
  type TemplateResolverApi,
  type TemplateResource,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  decryptTenantNames,
  TENANT_FEATURE,
  tenantTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  isUuid,
  SYSTEM_TENANT_ID,
  TENANT_CURRENCY_CONFIG_KEY,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { TENANT_TIMEZONE_CONFIG_KEY } from "@cosmicdrift/kumiko-framework/pipeline";
import { isValidIanaTimeZone } from "@cosmicdrift/kumiko-framework/time";
import {
  DOCUMENT_FALLBACK_CURRENCY,
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
} from "@cosmicdrift/kumiko-renderer/headless";
import Handlebars from "handlebars";
import { convert as htmlToText } from "html-to-text";

// Handlebars instance, template resolution and resource lookup shared by the
// mail and PDF renderers, so both format money/dates and find images the same way.

const documentKitLogger = createFallbackLogger("renderer-mail-html");
const SAFE_LINK_PROTOCOL = /^(https?:|mailto:)/i;

export type DocumentFormat = {
  readonly locale: string;
  readonly currency: string;
  /** Tenant zone for `{{date x time=true}}`; absent = UTC. */
  readonly timeZone?: string;
};

export function createDocumentHandlebars(format: DocumentFormat): typeof Handlebars {
  const hbs = Handlebars.create();
  hbs.registerHelper("money", (value: unknown): string =>
    formatDocumentMoney(value, format.currency, format.locale),
  );
  hbs.registerHelper("date", (value: unknown, options?: Handlebars.HelperOptions): string =>
    formatDocumentDate(value, format.locale, {
      time: options?.hash?.["time"] === true,
      ...(format.timeZone !== undefined && { timeZone: format.timeZone }),
    }),
  );
  hbs.registerHelper("percent", (value: unknown): string =>
    formatDocumentPercent(value, format.locale),
  );
  hbs.registerHelper(
    "richText",
    (value: unknown, options: Handlebars.HelperOptions): Handlebars.SafeString | string => {
      if (typeof value !== "string") return "";
      const sanitized = sanitizeDocumentHtml(value);
      if (sanitized.ok) {
        return new hbs.SafeString(
          options.hash["inline"] === true
            ? flattenParagraphsToLineBreaks(sanitized.html)
            : sanitized.html,
        );
      }
      // Rejected markup renders as visible text (escaped by Handlebars) instead of vanishing.
      documentKitLogger.warn("richText value rejected by sanitizer, rendered as escaped text", {
        violations: sanitized.violations.map((item) => item.code),
      });
      return value;
    },
  );
  hbs.registerHelper("richTextPlain", (value: unknown): string =>
    typeof value === "string"
      ? htmlToText(value, {
          wordwrap: false,
          selectors: [
            { selector: "a", options: { ignoreHref: true } },
            { selector: "img", format: "skip" },
          ],
        })
      : "",
  );
  hbs.registerHelper("link", (value: unknown): string =>
    typeof value === "string" && SAFE_LINK_PROTOCOL.test(value.trim()) ? value : "#",
  );
  hbs.registerHelper(
    "stepIs",
    function stepIs(
      this: unknown,
      value: unknown,
      index: unknown,
      keys: unknown,
      state: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return isStepInState(value, index, keys, state) ? options.fn(this) : options.inverse(this);
    },
  );
  return hbs;
}

// An unknown stage value reaches no stage: the row shows all stages as open.
function isStepInState(value: unknown, index: unknown, keys: unknown, state: unknown): boolean {
  if (typeof index !== "number" || typeof keys !== "string") return false;
  const current =
    typeof value === "string" || typeof value === "number"
      ? keys.split(",").indexOf(String(value).trim())
      : -1;
  if (current < 0) return false;
  return state === "current" ? index === current : index <= current;
}

const KNOWN_HELPERS = {
  each: true,
  if: true,
  money: true,
  date: true,
  link: true,
  richText: true,
  stepIs: true,
  percent: true,
  richTextPlain: true,
} as const;

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

// Dates and numbers follow the template locale, the language the document is
// read in; the tenant's locale setting must not turn a German invoice into
// "Oct 1, 2026". The currency is a tenant fact and still comes from its settings.
export async function readDocumentFormat(
  ctx: RendererContext,
  templateLocale: string,
): Promise<DocumentFormat> {
  const currency = await readConfigText(ctx, TENANT_CURRENCY_CONFIG_KEY);
  const zone = await readConfigText(ctx, TENANT_TIMEZONE_CONFIG_KEY);
  if (zone !== undefined && !isValidIanaTimeZone(zone)) {
    documentKitLogger.warn("tenant time zone is not a valid IANA zone, documents print UTC times", {
      tenantId: ctx.tenantId,
      configKey: TENANT_TIMEZONE_CONFIG_KEY,
      zone,
    });
  }
  return {
    locale: templateLocale,
    currency: currency ?? DOCUMENT_FALLBACK_CURRENCY,
    ...(zone !== undefined && isValidIanaTimeZone(zone) && { timeZone: zone }),
  };
}

// Without managed-pages there is no branding title; the tenant record's own name is the fallback.
export async function readTenantName(ctx: RendererContext): Promise<string> {
  const branded = await readConfigText(ctx, BRANDING_QN.title);
  if (branded !== undefined) return branded;
  if (ctx.registry.getFeature(TENANT_FEATURE) === undefined) return "";
  const rows = await selectMany<{ name?: unknown }>(ctx.db, tenantTable, { id: ctx.tenantId });
  const [row] = await decryptTenantNames(rows, "renderer-mail-html:tenant-name");
  return typeof row?.name === "string" ? row.name : "";
}

export async function readBrandingAccentColor(ctx: RendererContext): Promise<string | undefined> {
  const value = await readConfigText(ctx, BRANDING_QN.accentColor);
  return value !== undefined && isHexColor(value) ? value : undefined;
}

export async function readBrandingSiteUrl(ctx: RendererContext): Promise<string | undefined> {
  return readConfigText(ctx, BRANDING_QN.siteUrl);
}

export const LOGO_RESOURCE_KEY = "logo";

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
export async function readBrandingLogo(ctx: RendererContext): Promise<string | undefined> {
  const fileRefId = await readConfigText(ctx, BRANDING_QN.logoFile);
  if (fileRefId === undefined || !isUuid(fileRefId)) return undefined;
  const [row] = await selectMany<{ id: string }>(ctx.db, fileRefsTable, {
    id: fileRefId,
    tenantId: ctx.tenantId,
    isDeleted: false,
  });
  return row === undefined ? undefined : fileRefId;
}

// The branding mask also stores a logo address instead of an upload. Mail clients load it
// themselves; the PDF renderer must not, since the server would fetch an arbitrary URL.
export async function readBrandingLogoUrl(ctx: RendererContext): Promise<string | undefined> {
  const value = await readConfigText(ctx, BRANDING_QN.logoUrl);
  return value !== undefined && isSafeHttpsUrl(value) ? value : undefined;
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
