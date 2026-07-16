import { computeRevisionEtag } from "@cosmicdrift/kumiko-framework/api";
import {
  defineFeature,
  type FeatureDefinition,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { LEGAL_ROUTES } from "../legal-pages";
import { cachedSecurePageResponse } from "../page-render";
import { SEO_CONFIG_KEYS, SEO_DEFAULT_PATHS } from "./constants";
import { seoConfigQuery } from "./handlers/seo-config.query";
import { buildLlmsTxt } from "./llms-txt";
import { buildRobotsTxt, type RobotsPolicy } from "./robots-txt";
import { buildSitemapXml, type SitemapEntry } from "./sitemap";

// 300s-shared-cache: sitemap/llms.txt change rarely (new page publish, not
// per-request), longer than legal-pages/managed-pages' 60s content cache.
const SEO_CACHE = { kind: "revalidate", maxAgeSeconds: 300 } as const;

const MANAGED_PAGES_BY_TENANT_PUBLISHED_QN = "managed-pages:query:by-tenant-published";
const SEO_CONFIG_QUERY_QN = "seo:query:config";

// Minimal shape of the httpRoute handler's `{ systemQuery }` dep — just
// enough to force a specific tenant in-process. Not importing
// HttpRouteHandlerDeps itself: it isn't part of the engine's public surface
// (only the httpRoute-registration types are).
type SystemQueryFn = (type: string, payload: unknown, tenantId: string) => Promise<unknown>;

export type ManagedPagesDiscoveryOptions = {
  /** Same per-host tenant resolver the app already passes to
   *  createManagedPagesFeature — needed to X-Tenant-scope the anonymous
   *  by-tenant-published query. */
  readonly resolveApexTenant: (host: string) => Promise<string | null> | string | null;
  /** Must match the basePath passed to createManagedPagesFeature. Default "/p". */
  readonly basePath?: string;
};

export type SeoOptions = {
  /** Primary page inventory for sitemap.xml/llms.txt. App-authored, trusted
   *  (same trust boundary as ApexCta.href) — return fully-qualified absolute
   *  URLs. Called once per request with the resolved request Host. */
  readonly sitemapEntries: (
    host: string,
  ) => Promise<readonly SitemapEntry[]> | readonly SitemapEntry[];
  /** Merge legal-pages' 4 fixed routes into sitemap.xml/llms.txt. Set true
   *  only when the app ALSO mounts createLegalPagesFeature() — this does not
   *  detect it automatically (no such feature-presence hook exists at the
   *  httpRoute layer). Default false. */
  readonly includeLegalPages?: boolean;
  /** Merge managed-pages' published slugs (via its anonymous
   *  by-tenant-published query) into sitemap.xml/llms.txt. Omit if the app
   *  doesn't mount managed-pages, or already includes those URLs in
   *  `sitemapEntries` itself. */
  readonly managedPages?: ManagedPagesDiscoveryOptions;
  /** Serves GET /robots.txt with per-host policy. Default: no route — the
   *  static `public/robots.txt` dev-server already ships covers the common
   *  case (no per-host logic needed). Only opt in for staging/preview hosts
   *  that need a different (e.g. Disallow: /) policy at runtime. */
  readonly robotsPolicy?: (host: string) => Promise<RobotsPolicy> | RobotsPolicy;
  /** Override the 3 mount paths. Default: /sitemap.xml, /llms.txt, /robots.txt. */
  readonly basePaths?: Partial<typeof SEO_DEFAULT_PATHS>;
};

type SeoConfigValues = {
  readonly organizationName: string;
  readonly organizationLogoUrl: string;
  readonly twitterSite: string;
  readonly llmsSummary: string;
  readonly defaultOgImage: string;
};

const EMPTY_SEO_CONFIG: SeoConfigValues = {
  organizationName: "",
  organizationLogoUrl: "",
  twitterSite: "",
  llmsSummary: "",
  defaultOgImage: "",
};

// Config is decoration, not a hard dependency — a failed/unreachable read
// degrades to empty strings (same posture as managed-pages' readBrandingResponse).
// systemQuery forces tenantId in-process — no internal X-Tenant self-fetch,
// which a host-based anonymousAccess resolver in "authoritative" mode would
// reject as a forged client override.
async function readSeoConfig(
  systemQuery: SystemQueryFn,
  tenantId: string,
): Promise<SeoConfigValues> {
  try {
    const data = (await systemQuery(SEO_CONFIG_QUERY_QN, {}, tenantId)) as Partial<SeoConfigValues>;
    return { ...EMPTY_SEO_CONFIG, ...data };
  } catch {
    return EMPTY_SEO_CONFIG;
  }
}

// Merges the app callback with the optional legal-pages/managed-pages
// sources. legal-pages routes are static (no per-tenant data) — merged
// directly from the public LEGAL_ROUTES constant. managed-pages entries need
// a live query (per-tenant published slugs) — merged via systemQuery, same
// cross-feature decoupling as legal-pages' own text-content calls; a
// failed/unreachable read degrades to "no managed-pages entries" rather than
// failing the whole route.
async function gatherEntries(
  opts: SeoOptions,
  systemQuery: SystemQueryFn,
  origin: string,
  host: string,
): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = [...(await opts.sitemapEntries(host))];

  if (opts.includeLegalPages) {
    for (const route of LEGAL_ROUTES) {
      entries.push({ loc: `${origin}${route.path}` });
    }
  }

  if (opts.managedPages) {
    const tenantId = await opts.managedPages.resolveApexTenant(host);
    if (tenantId) {
      try {
        const data = (await systemQuery(MANAGED_PAGES_BY_TENANT_PUBLISHED_QN, {}, tenantId)) as {
          pages?: readonly { slug: string; title: string; updatedAt: string }[];
        };
        const basePath = opts.managedPages.basePath ?? "/p";
        for (const page of data.pages ?? []) {
          entries.push({
            loc: `${origin}${basePath}/${page.slug}`,
            title: page.title,
            lastmod: page.updatedAt,
          });
        }
      } catch {
        // managed-pages unreachable/not mounted — degrade to callback-only entries.
      }
    }
  }

  return entries;
}

// TLS-terminating reverse proxies (ingress-nginx et al.) forward the
// original request over plain HTTP internally, so `c.req.url`'s scheme
// reflects the proxy hop, not what the client actually used — trusting it
// downgraded every legal-pages/managed-pages URL in sitemap.xml/llms.txt to
// http:// in production. `x-forwarded-proto` carries the real scheme;
// fall back to the raw URL only when the header is absent (plain local dev).
function requestHost(c: { req: { header: (name: string) => string | undefined; url: string } }): {
  origin: string;
  host: string;
} {
  const url = new URL(c.req.url);
  const host = c.req.header("host") ?? url.host;
  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : url.protocol.replace(":", "");
  return { origin: `${protocol}://${host}`, host };
}

// seo — site-discovery routes (sitemap.xml/llms.txt/robots.txt) plus the
// wrapInLayout OG/JSON-LD extension (page-render/layout.ts's `seo` opt) and
// the organizationSchema/webPageSchema/faqPageSchema JSON-LD builders
// (schema-builders.ts, imported directly by apps — not wired into this
// feature's own routes). Complements the apex ApexHead/renderApexPage
// renderer, which already ships full OG/JSON-LD/canonical head handling —
// this feature only fills the site-discovery + CMS-page-head gaps.
export function createSeoFeature(opts: SeoOptions): FeatureDefinition {
  const paths = { ...SEO_DEFAULT_PATHS, ...opts.basePaths };

  return defineFeature("seo", (r) => {
    r.describe(
      `Site-discovery + SEO/AEO/GEO surface for apex/content pages. Serves GET ${paths.sitemap} and GET ${paths.llmsTxt} (both anonymous, revalidate-cached), merging the app-supplied sitemapEntries() callback with legal-pages' fixed routes (includeLegalPages) and/or managed-pages' published slugs (managedPages.resolveApexTenant) when opted in. Serves GET ${paths.robots} only when robotsPolicy is supplied (default off — the static public/robots.txt already covers the common case). Tenant-scoped config keys (seo:config:seo-organization-{name,logo-url}, seo:config:seo-twitter-site, seo:config:seo-llms-summary, seo:config:seo-default-og-image) feed the Organization JSON-LD helper + llms.txt summary. Also exports pure schema.org JSON-LD builders (organizationSchema/webPageSchema/faqPageSchema) for apps to pass into ApexHead.schemaJson or wrapInLayout({ seo: { schemaJson } }) directly — this feature does not inject JSON-LD on its own routes.`,
    );
    r.uiHints({
      displayLabel: "SEO / Site Discovery",
      category: "content",
      recommended: false,
    });
    // config keys need the config feature's write/read machinery to actually
    // function (same hard dependency managed-pages has) — only legal-pages/
    // managed-pages are genuinely optional (merged only when opted in).
    r.requires("config");
    r.optionalRequires("legal-pages", "managed-pages");

    r.config({ keys: SEO_CONFIG_KEYS });
    r.queryHandler(seoConfigQuery);

    r.httpRoute({
      method: "GET",
      path: paths.sitemap,
      anonymous: true,
      handler: async (c, { systemQuery }) => {
        const { origin, host } = requestHost(c);
        const entries = await gatherEntries(opts, systemQuery, origin, host);
        const xml = buildSitemapXml(entries);
        const etag = computeRevisionEtag([host, xml]);
        return cachedSecurePageResponse(c.req.raw, {
          body: xml,
          etag,
          cache: SEO_CACHE,
          extra: { "content-type": "application/xml; charset=utf-8" },
        });
      },
    });

    r.httpRoute({
      method: "GET",
      path: paths.llmsTxt,
      anonymous: true,
      handler: async (c, { systemQuery }) => {
        const { origin, host } = requestHost(c);
        const tenantId = opts.managedPages
          ? ((await opts.managedPages.resolveApexTenant(host)) ?? SYSTEM_TENANT_ID)
          : SYSTEM_TENANT_ID;
        const [entries, seoConfig] = await Promise.all([
          gatherEntries(opts, systemQuery, origin, host),
          readSeoConfig(systemQuery, tenantId),
        ]);
        const sections =
          entries.length > 0
            ? [
                {
                  heading: "Pages",
                  links: entries.map((e) => ({ title: e.title ?? e.loc, url: e.loc })),
                },
              ]
            : [];
        const text = buildLlmsTxt({
          title: seoConfig.organizationName || host,
          summary: seoConfig.llmsSummary,
          sections,
        });
        const etag = computeRevisionEtag([host, text]);
        return cachedSecurePageResponse(c.req.raw, {
          body: text,
          etag,
          cache: SEO_CACHE,
          extra: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    });

    if (opts.robotsPolicy) {
      const robotsPolicy = opts.robotsPolicy;
      r.httpRoute({
        method: "GET",
        path: paths.robots,
        anonymous: true,
        handler: async (c) => {
          const { host } = requestHost(c);
          const policy = await robotsPolicy(host);
          const text = buildRobotsTxt(policy);
          const etag = computeRevisionEtag([host, text]);
          return cachedSecurePageResponse(c.req.raw, {
            body: text,
            etag,
            cache: SEO_CACHE,
            extra: { "content-type": "text/plain; charset=utf-8" },
          });
        },
      });
    }

    // Boot-Check body als named function extrahiert — direkt unit-testbar,
    // gleiches "thin job-shell ruft testable function"-Pattern wie
    // legal-pages' runLegalPagesBootCheck.
    r.job(
      "seo-boot-check",
      { trigger: { manual: true }, runOnBoot: true, runIn: "api" },
      async (_payload, ctx) =>
        runSeoBootCheck({
          sitemapEntries: opts.sitemapEntries,
          includeLegalPages: opts.includeLegalPages ?? false,
          hasManagedPages: opts.managedPages !== undefined,
          log: ctx.log,
        }),
    );

    return {};
  });
}

export type SeoBootCheckCtx = {
  readonly sitemapEntries: (
    host: string,
  ) => Promise<readonly SitemapEntry[]> | readonly SitemapEntry[];
  readonly includeLegalPages: boolean;
  /** managedPages entries are only resolvable per-request (need a live
   *  tenant + query) — the boot-check can't probe them, so their mere
   *  presence counts as "has a source" rather than sampling actual rows. */
  readonly hasManagedPages: boolean;
  readonly log?: {
    readonly info?: (msg: string) => void;
    readonly warn?: (msg: string) => void;
  };
};

// Exported for direct tests. Throws in NODE_ENV=production when NONE of the
// three entry sources (sitemapEntries() probe, includeLegalPages,
// managedPages) can supply anything — the routes would otherwise serve a
// permanently empty document. Otherwise log.warn. Logs log.info when at
// least one source is present.
export async function runSeoBootCheck(ctx: SeoBootCheckCtx): Promise<void> {
  const sample = await ctx.sitemapEntries("boot-check.invalid");
  const hasSource = sample.length > 0 || ctx.includeLegalPages || ctx.hasManagedPages;

  if (hasSource) {
    ctx.log?.info?.("seo boot-check: sitemap/llms.txt have at least one entry source");
  } else {
    const message =
      "seo: sitemapEntries() returned no entries and neither includeLegalPages " +
      "nor managedPages is set — sitemap.xml/llms.txt will serve an empty " +
      "document. Wire real entries, set includeLegalPages:true, or pass managedPages.";

    if (process.env["NODE_ENV"] === "production") {
      throw new Error(`Boot-Validation failed: ${message}`);
    }
    ctx.log?.warn?.(message);
  }
}
