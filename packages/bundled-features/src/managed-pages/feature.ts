import { computeRevisionEtag, etagMatches } from "@cosmicdrift/kumiko-framework/api";
import {
  defineFeature,
  type FeatureDefinition,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { RateLimitError } from "@cosmicdrift/kumiko-framework/errors";
import { escapeHtmlAttr } from "@cosmicdrift/kumiko-renderer/headless";
import { BRANDING_TOKENS_QUERY_QN, coerceBranding } from "../branding/index.ts";
import {
  type BrandingTokens,
  brandingHeaderHtml,
  brandingStyleBlock,
  cachedSecurePageResponse,
  EMPTY_BRANDING,
  isSafeHttpsUrl,
  tenantStyleBlock,
  wrapInLayout,
} from "../page-render/index.ts";
import { rateLimitedTextResponse, type SystemQueryFn } from "../shared/index.ts";
import { type BodyFormat, MANAGED_PAGES_FEATURE } from "./constants.ts";
import { bySlugQuery } from "./handlers/by-slug.query.ts";
import { byTenantPublishedQuery } from "./handlers/by-tenant-published.query.ts";
import { pageCrudQueries, pageCrudWrites } from "./handlers/page-crud.ts";
import { setWrite } from "./handlers/set.write.ts";
import { renderPageBody } from "./render-page-body.ts";
import { pageEditScreen, pageListScreen } from "./screens/page-screens.ts";
import { pageEntity } from "./table.ts";
import { MANAGED_PAGES_I18N } from "./web/i18n.ts";

// 60s-shared-cache saves the origin-revalidate roundtrip; CMS edits are live within 60s.
const PUBLIC_PAGE_CACHE = { kind: "revalidate", maxAgeSeconds: 60 } as const;

// QN constant as a documented public contract — the render path calls
// the by-slug query in-process via systemQuery (without importing the
// handler's code, symmetrically with the legal-pages pattern).
const BY_SLUG_QN = "managed-pages:query:by-slug";

// Raw handler return from bySlugQuery (published-only) — systemQuery dispatches
// directly to the handler, without the `{data}` envelope used on the /api/query wire.
type BySlugQueryResult = {
  title: string;
  body: string;
  bodyFormat: BodyFormat;
  lang: string;
  description: string | null;
  ogImage: string | null;
  version: number;
  updatedAt: string;
} | null;

function brandingRevisionSeed(branding: BrandingTokens): string {
  return JSON.stringify([
    branding.title,
    branding.description,
    branding.siteUrl,
    branding.accentColor,
    branding.logoUrl,
    branding.logoFile,
    branding.layoutPreset,
    branding.customCss,
  ]);
}

// A query failure or malformed result degrades to the unbranded default
// (branding is decoration, not a hard dependency of the page render). A rate
// limit is rethrown so the route answers 429 instead of serving (and caching)
// an unbranded page.
async function readBrandingViaSystemQuery(
  systemQuery: SystemQueryFn,
  tenantId: string,
): Promise<BrandingTokens> {
  try {
    return coerceBranding(await systemQuery(BRANDING_TOKENS_QUERY_QN, {}, tenantId));
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    return EMPTY_BRANDING;
  }
}

// Every tenant value arrives escaped or sanitized, so a custom layout may interpolate each field
// as is; brandingStyleHtml belongs after the layout's own <style>, the content container carries TENANT_CONTENT_ATTR.
export type ManagedPagesWrapLayout = (parts: {
  readonly bodyHtml: string;
  readonly titleHtml: string;
  readonly descriptionHtml: string;
  readonly langHtml: string;
  readonly slugHtml: string;
  readonly ogImageHtml: string;
  readonly brandingStyleHtml: string;
  readonly brandingHeaderHtml: string;
}) => string;

function escapedLayoutParts(args: {
  readonly page: NonNullable<BySlugQueryResult>;
  readonly slug: string;
  readonly bodyHtml: string;
  readonly branding: BrandingTokens;
}): Parameters<ManagedPagesWrapLayout>[0] {
  const { page, slug, bodyHtml, branding } = args;
  const description =
    page.description && page.description.length > 0 ? page.description : branding.description;
  return {
    bodyHtml,
    titleHtml: escapeHtmlAttr(page.title),
    descriptionHtml: escapeHtmlAttr(description ?? ""),
    langHtml: escapeHtmlAttr(page.lang),
    slugHtml: escapeHtmlAttr(slug),
    ogImageHtml: page.ogImage && isSafeHttpsUrl(page.ogImage) ? escapeHtmlAttr(page.ogImage) : "",
    brandingStyleHtml: brandingStyleBlock(branding) + tenantStyleBlock(branding.customCss),
    brandingHeaderHtml: brandingHeaderHtml(branding),
  };
}

export type ApexTenantResolver = (
  host: string,
  deps: { readonly hostTenantId: () => Promise<TenantId | null> },
) => Promise<string | null> | string | null;

export type ManagedPagesOptions = {
  /** Host → tenantId for the anonymous page route; NULL → 404. Omit it to use the
   *  server's own host resolution (`deps.hostTenantId()`: host-routing, a tenant
   *  resolver or `anonymousAccess.defaultTenantId`). Pass it for a fixed tenant or
   *  an app-specific mapping; `deps.hostTenantId` is available inside it. */
  readonly resolveApexTenant?: ApexTenantResolver;
  /** Custom layout wrapper. Receives only escaped or sanitized parts (see
   *  ManagedPagesWrapLayout); without it the default skeleton wrapInLayout applies. */
  readonly wrapLayout?: ManagedPagesWrapLayout;
  /** Base path for page routes. Default "/p" → GET /p/:slug. */
  readonly basePath?: string;
  /** Default language when `?lang=` is missing. Default "en". */
  readonly defaultLang?: string;
};

// managed-pages — tenant-editable, server-rendered public pages.
// Generalizes the legal-pages rendering pattern: a dynamic slug route
// (`GET /p/:slug`) that resolves the tenant from the Host (resolveApexTenant),
// loads the published page, renders hardened Markdown (page-render), and wraps
// it in chrome through an optional wrapLayout. Drafts → 404. Per-tenant
// content is cache-isolated through `Vary: Host`.
//
// Admin authoring: registers entityList + entityEdit for `page` (TenantAdmin/
// SystemAdmin) and the convention CRUD handlers dispatched by the renderer.
// The screens MUST live here (the boot validator requires the entity reference
// in the same feature); navigation/workspace remains the app's responsibility.
//
// App bootstrap requirements:
//   • anonymousAccess must be wired to honor the X-Tenant header
//     — multi-tenant apps use a tenantResolver (or no defaultTenantId).
//     A fixed defaultTenantId locks the app to single-tenant mode and rejects
//     the per-page X-Tenant with 400 tenant_mismatch.
//   • Admin UI: the app exposes these screens via `r.nav({ screen:
//     "managed-pages:screen:page-list" })` plus a workspace entry
//     (cross-feature Nav→Screen is globally validated) and grants its admins
//     TenantAdmin. Without navigation, the screens remain dormant — no leak in
//     flat-nav apps that use managed-pages only for public rendering.
export function createManagedPagesFeature(opts: ManagedPagesOptions): FeatureDefinition {
  const basePath = opts.basePath ?? "/p";
  const defaultLang = opts.defaultLang ?? "en";

  return defineFeature(MANAGED_PAGES_FEATURE, (r) => {
    r.adoptsBundledLists();
    r.describe(
      "Tenant-editable, server-rendered public pages with per-tenant branding. Stores one `page` (Markdown or editor-document HTML body, per `bodyFormat`) per `(tenantId, slug, lang)` in the `read_pages` entity table with a `published` gate plus `description`/`ogImage` SEO meta. Registers an anonymous `GET {basePath}/:slug` route that resolves the tenant from the request Host through the server's host resolution (`deps.hostTenantId`) or an app-supplied `resolveApexTenant`, serves only published pages (drafts → 404), renders Markdown through the hardened `page-render` core and document bodies through the template-resolver document sanitizer, and isolates per-tenant content with `Vary: Host`. Ships TenantAdmin/SystemAdmin admin screens (`entityList` + `entityEdit`) backed by convention CRUD handlers (`managed-pages:write:page:{create,update,delete}`, `managed-pages:query:page:{list,detail}`); the app wires nav/workspace onto `managed-pages:screen:page-list`. Also exposes `managed-pages:query:by-tenant-published` (anonymous, SQL-filtered on `published`) for sitemap/discovery consumers such as the `seo` feature. Branding comes from the branding feature (branding:query:tokens); the render path applies it as scoped `:root` CSS vars + a logo/title header. Also exposes `managed-pages:write:set` (idempotent slug-keyed upsert, SystemAdmin cross-tenant via `tenantIdOverride`) as a provisioning API. Requires `config`, `branding` + `anonymousAccess` wired at app bootstrap.",
    );
    r.uiHints({
      displayLabel: "Managed Pages · Public CMS",
      category: "content",
      recommended: false,
    });
    r.requires({ features: ["config", "branding"] });
    r.entity({ name: "page", ...pageEntity });

    const handlers = { set: r.writeHandler(setWrite) };
    const queries = {
      bySlug: r.queryHandler(bySlugQuery),
      byTenantPublished: r.queryHandler(byTenantPublishedQuery),
    };

    for (const def of pageCrudWrites) r.writeHandler(def);
    for (const def of pageCrudQueries) r.queryHandler(def);

    r.screen(pageListScreen);
    r.screen(pageEditScreen);

    r.translations({ keys: MANAGED_PAGES_I18N });

    r.httpRoute({
      method: "GET",
      path: `${basePath}/:slug`,
      anonymous: true,
      handler: async (c, { systemQuery, hostTenantId }) => {
        // `param("slug")` is string|undefined because `path` is a computed
        // template (Hono infers `:slug` only from string literals).
        const slug = c.req.param("slug");
        if (!slug) return c.text("not found", 404);
        const lang = c.req.query("lang") || defaultLang;
        const url = new URL(c.req.url);
        // Host-Header zuerst (prod hinter Proxy), URL-Host als Fallback.
        const host = c.req.header("host") ?? url.host;

        const tenantId = opts.resolveApexTenant
          ? await opts.resolveApexTenant(host, { hostTenantId })
          : await hostTenantId();
        if (!tenantId) return c.text("not found", 404);

        // Page and branding are read in parallel, both forced through systemQuery
        // in-process for the host-resolved tenantId (no X-Tenant header trick
        // through app.fetch — for a host-based anonymousAccess resolver, that
        // would look like a client override and would rightly be rejected by
        // resolverTrust: "authoritative"; see systemQuery's documentation in
        // http-route.ts). Branding is decorative → a failure degrades to the
        // unbranded default and never blocks the page.
        let pageSettled: { ok: true; data: BySlugQueryResult } | { ok: false };
        let brandingResult: BrandingTokens;
        try {
          [pageSettled, brandingResult] = await Promise.all([
            systemQuery(BY_SLUG_QN, { slug, lang }, tenantId)
              .then((data) => ({ ok: true as const, data: data as BySlugQueryResult }))
              .catch((error: unknown) => {
                if (error instanceof RateLimitError) throw error;
                return { ok: false as const };
              }),
            readBrandingViaSystemQuery(systemQuery, tenantId),
          ]);
        } catch (error) {
          if (error instanceof RateLimitError) return rateLimitedTextResponse(error);
          throw error;
        }
        if (!pageSettled.ok) return c.text("page unavailable", 503);

        const data = pageSettled.data;
        if (!data) return c.text("not found", 404);

        const branding = brandingResult;

        const etag = computeRevisionEtag([
          tenantId,
          slug,
          lang,
          String(data.version),
          data.bodyFormat,
          data.updatedAt,
          brandingRevisionSeed(branding),
        ]);
        const pageHeaders = {
          "content-type": "text/html; charset=utf-8",
          vary: "Host",
        } as const;
        // 304 (unchanged revision) and HEAD both skip Markdown rendering — the body
        // would be discarded anyway.
        if (etagMatches(c.req.raw.headers.get("if-none-match"), etag) || c.req.method === "HEAD") {
          return cachedSecurePageResponse(c.req.raw, {
            body: null,
            etag,
            cache: PUBLIC_PAGE_CACHE,
            extra: pageHeaders,
          });
        }

        const bodyHtml = renderPageBody({
          tenantId,
          slug,
          lang,
          version: data.version,
          updatedAt: data.updatedAt,
          body: data.body,
          bodyFormat: data.bodyFormat,
        });
        const html = opts.wrapLayout
          ? opts.wrapLayout(escapedLayoutParts({ page: data, slug, bodyHtml, branding }))
          : wrapInLayout({
              title: data.title,
              bodyHtml,
              lang: data.lang,
              description: data.description,
              branding,
            });

        return cachedSecurePageResponse(c.req.raw, {
          body: html,
          etag,
          cache: PUBLIC_PAGE_CACHE,
          extra: pageHeaders,
        });
      },
    });

    return { handlers, queries };
  });
}
