import { computeRevisionEtag, etagMatches } from "@cosmicdrift/kumiko-framework/api";
import {
  bootRuleError,
  defineFeature,
  type FeatureDefinition,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { escapeHtml } from "@cosmicdrift/kumiko-renderer/headless";
import {
  cachedSecurePageResponse,
  type PublicPageWrapLayout,
  redirectToCanonicalPath,
  slashVariantOf,
} from "../page-render/index.ts";
import { LEGAL_PAGES_BOOT_RULES } from "./boot-rules.ts";
import { runLegalPagesBootCheck } from "./lib/boot-check.ts";
import { validateRoutes } from "./lib/validate-routes.ts";
import { renderMarkdownToHtml, wrapInLayout } from "./markdown.ts";
import {
  LEGAL_REQUIRED_BLOCKS,
  LEGAL_ROUTES,
  LEGAL_TERMS_ROUTES,
  type LegalPageRoute,
  type LegalRequiredBlock,
} from "./web/constants.ts";

export { type LegalPagesBootCheckCtx, runLegalPagesBootCheck } from "./lib/boot-check.ts";

// QN constant as the documented public contract of the template-resolver
// feature. A magic string is intentional instead of a code import: cross-feature
// calls use only the stable public API (handler name + payload shape), not
// internal module references. If template-resolver's handler name changes, it is
// a semver-major change and must be synchronized in both features—the same risk
// as with any API endpoint.
const TEXT_BLOCK_BY_SLUG_QN = "template-resolver:query:by-slug";

// Return shape of bySlugQuery (template-resolver/handlers/by-slug.query.ts).
type TextBlockQueryResult = {
  title: string | null;
  content: string | null;
  // In-process systemQuery hands back the Temporal.Instant itself, not JSON.
  modifiedAt: { toString(): string } | null;
} | null;

// 60s-shared-cache saves the origin-revalidate roundtrip; legal-content edits are live within 60s.
const PUBLIC_PAGE_CACHE = { kind: "revalidate", maxAgeSeconds: 60 } as const;

// legal-pages — opt-in wrapper around template-resolver (kind text-block).
// Default config ships four DACH public HTML routes (/legal/impressum,
// /legal/datenschutz, /legal/imprint, /legal/privacy) with Markdown-to-HTML
// rendering and a boot check that hard-fails in production when the DE
// required blocks aren't seeded. `routes`/`requiredBlocks` are configurable
// (see LegalPagesOptions) for apps with a different default language or
// additional pages (e.g. terms/AGB).
//
// Cross-Feature-Decoupling:
//   • Routes use app.fetch to "/api/query" with the QN string
//     `template-resolver:query:by-slug`—no code import from template-resolver
//   • The boot check uses ctx.templateResolver (via extraContext), symmetrically
//     with the config/tenant pattern
//   • The single type import (TemplateResolverApi) remains; type-only imports do
//     not violate cross-feature coupling
//
// Production requirements:
//   • App bootstrap must set extraContext: { templateResolver: createTemplateResolverApi(db,
//     registry) } —otherwise the boot check throws at startup
//   • anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID }—otherwise
//     the routes respond with 503
export type LegalPagesWrapLayout = PublicPageWrapLayout;

export type LegalPagesOptions = {
  /** Custom layout wrapper for the /legal/* routes. Default: minimal
   *  HTML skeleton from markdown.ts (`wrapInLayout`). Apps that want to place
   *  their own marketing layout (header/footer/theme) around the legal body
   *  can provide their render function here. */
  readonly wrapLayout?: LegalPagesWrapLayout;
  /** Public HTML routes to register. Default: LEGAL_ROUTES (DACH: DE+EN
   *  imprint/privacy). Non-DACH apps (other default language, additional
   *  pages like terms/AGB) pass their own list instead. Validated at
   *  feature-build time: no duplicate `path`, no empty field, every `path`
   *  starts with "/". An empty array is allowed (boot-check only, no
   *  public routes). */
  readonly routes?: readonly LegalPageRoute[];
  /** Slug+lang combos the boot check requires to be seeded in
   *  SYSTEM_TENANT. Default: LEGAL_REQUIRED_BLOCKS (`imprint/de`,
   *  `privacy/de`). Apps whose routes use a different slug/lang set
   *  (e.g. Spanish-default) pass their own list here. */
  readonly requiredBlocks?: readonly LegalRequiredBlock[];
  /** Also serve LEGAL_TERMS_ROUTES (`/legal/nutzungsbedingungen`,
   *  `/legal/terms`, slug `terms`). Appended to `routes`; never boot-required. */
  readonly terms?: boolean;
};

// Only slugs served in more than one language get alternates.
function alternatesBySlugOf(
  routes: readonly LegalPageRoute[],
): ReadonlyMap<string, Readonly<Record<string, string>>> {
  const bySlug = new Map<string, Record<string, string>>();
  for (const route of routes) {
    bySlug.set(route.slug, { ...bySlug.get(route.slug), [route.lang]: route.path });
  }
  return new Map([...bySlug].filter(([, byLang]) => Object.keys(byLang).length > 1));
}

export function createLegalPagesFeature(opts: LegalPagesOptions = {}): FeatureDefinition {
  const wrapLayout = opts.wrapLayout ?? wrapInLayout;
  const routes: readonly LegalPageRoute[] = [
    ...(opts.routes ?? LEGAL_ROUTES),
    ...(opts.terms === true ? LEGAL_TERMS_ROUTES : []),
  ];
  const requiredBlocks = opts.requiredBlocks ?? LEGAL_REQUIRED_BLOCKS;
  validateRoutes(routes);
  if (opts.routes !== undefined && opts.routes.length > 0 && opts.requiredBlocks === undefined) {
    const coversDefaultBlock = LEGAL_REQUIRED_BLOCKS.some((block) =>
      opts.routes?.some((route) => route.slug === block.slug && route.lang === block.lang),
    );
    if (!coversDefaultBlock) {
      throw bootRuleError(LEGAL_PAGES_BOOT_RULES.routesWithoutRequiredBlocks, {
        message:
          "legal-pages: custom `routes` without `requiredBlocks` — pass `requiredBlocks` explicitly (or `[]`)",
      });
    }
  }
  const alternatesBySlug = alternatesBySlugOf(routes);
  return defineFeature("legal-pages", (r) => {
    r.describe(
      "Opt-in wrapper around `template-resolver` text-blocks that registers public HTML routes (default: `/legal/impressum`, `/legal/datenschutz`, `/legal/imprint`, `/legal/privacy`) with Markdown-to-HTML rendering and a boot-time job that hard-fails in production when the required blocks (default: `imprint/de`, `privacy/de`) are not seeded in `SYSTEM_TENANT`. Both are configurable via `routes`/`requiredBlocks` for apps with a different default language or additional pages. Requires `anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID }` and `extraContext.templateResolver` to be wired at app bootstrap; for per-tenant imprints or a custom layout call `template-resolver:query:by-slug` directly.",
    );
    r.uiHints({
      displayLabel: "Legal Pages",
      category: "content",
      recommended: false,
    });
    r.requires({ features: ["template-resolver"] });

    // Public HTML routes (default: 4 DACH routes, configurable via opts.routes)
    for (const route of routes) {
      r.httpRoute({
        method: "GET",
        path: route.path,
        anonymous: true,
        // Public pages backed by a DB query: bound the per-IP read rate.
        rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
        handler: async (c, { systemQuery }) => {
          // Architecture: 1 app = X tenants = 1 imprint. Regardless of which
          // subdomain the visitor uses (apex, admin.*, tenant-x.*),
          // legal-pages ALWAYS serves the SYSTEM_TENANT texts. systemQuery
          // enforces SYSTEM_TENANT_ID in-process (no X-Tenant-Header trick
          // through app.fetch—the host-based anonymousAccess resolver would
          // see that as a client override and correctly reject it with
          // resolverTrust: "authoritative").
          let data: TextBlockQueryResult;
          try {
            // @cast-boundary engine-payload — dispatcher.query returnt
            // unknown; the shape is trusted because of bySlugQuery's handler return type
            // (see template-resolver/handlers/by-slug.query.ts).
            data = (await systemQuery(
              TEXT_BLOCK_BY_SLUG_QN,
              { slug: route.slug, locale: route.lang },
              SYSTEM_TENANT_ID,
            )) as TextBlockQueryResult;
          } catch (err) {
            // biome-ignore lint/suspicious/noConsole: ops-visible fallback, no logger wired into HttpRouteHandlerDeps
            console.error(`legal-pages: text-block query failed for slug="${route.slug}"`, err);
            return c.text("legal page unavailable", 503);
          }

          if (!data?.content) {
            return c.text(
              `${route.titleFallback} not configured. Tenant-Admin must set this text-block.`,
              404,
            );
          }

          const etag = computeRevisionEtag([
            SYSTEM_TENANT_ID,
            route.path,
            route.slug,
            route.lang,
            String(data.modifiedAt ?? ""),
          ]);
          const extra = { "content-type": "text/html; charset=utf-8" };
          // Both 304 (unchanged revision) and HEAD skip Markdown rendering—the body
          // would be discarded anyway.
          if (
            etagMatches(c.req.raw.headers.get("if-none-match"), etag) ||
            c.req.method === "HEAD"
          ) {
            return cachedSecurePageResponse(c.req.raw, {
              body: null,
              etag,
              cache: PUBLIC_PAGE_CACHE,
              extra,
            });
          }

          const title = data.title || route.titleFallback;
          const renderedBody = renderMarkdownToHtml(data.content);
          const html = wrapLayout({
            title,
            bodyHtml: route.titleHeading
              ? `<h1>${escapeHtml(title)}</h1>${renderedBody}`
              : renderedBody,
            lang: route.lang,
            slug: route.slug,
            alternates: alternatesBySlug.get(route.slug),
          });

          return cachedSecurePageResponse(c.req.raw, {
            body: html,
            etag,
            cache: PUBLIC_PAGE_CACHE,
            extra,
          });
        },
      });
    }

    // Hono matches strictly, so "/legal/x/" would 404 for sites that link with
    // a trailing slash. GET also serves HEAD.
    const configuredPaths = new Set(routes.map((route) => route.path));
    for (const route of routes) {
      const variant = slashVariantOf(route.path);
      if (variant === null || configuredPaths.has(variant)) continue;
      r.httpRoute({
        method: "GET",
        path: variant,
        anonymous: true,
        handler: (c) => redirectToCanonicalPath(c.req.url, route.path),
      });
    }

    // Boot check via ctx.templateResolver (extraContext pattern, symmetrical
    // with requireConfigResolver in config). App bootstrap must wire
    // templateResolver; the helper gives a clear wiring hint if it is missing.
    //
    // The body is extracted as the named function (`runLegalPagesBootCheck`) so
    // the logic can be unit-tested directly instead of only indirectly through
    // routes. Pattern: a thin job shell calls a testable function, avoiding
    // coupling tests to the JobRunner.
    r.job(
      "legal-pages-boot-check",
      {
        trigger: { manual: true },
        // bootGate, not runOnBoot: only an inline gate can actually abort the
        // boot. runOnBoot merely enqueues, so a missing imprint would fail a
        // queue job while the pod goes ready anyway.
        bootGate: true,
        runIn: "api",
      },
      async (_payload, ctx) => runLegalPagesBootCheck(ctx, requiredBlocks),
    );

    return {};
  });
}
