import { computeRevisionEtag, etagMatches } from "@cosmicdrift/kumiko-framework/api";
import {
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  type BrandingTokens,
  cachedSecurePageResponse,
  EMPTY_BRANDING,
  renderSafeMarkdown,
  wrapInLayout,
} from "../page-render";
import { BRANDING_KEYS, BRANDING_QUERY_QN, CUSTOM_CSS_KEY, coerceBranding } from "./branding";
import { createBrandingQuery } from "./handlers/branding.query";
import { bySlugQuery } from "./handlers/by-slug.query";
import { setWrite } from "./handlers/set.write";
import { MANAGED_PAGES_I18N } from "./i18n";
import { createBrandingSettingsScreen } from "./screens/branding-screen";
import { pageEditScreen, pageListScreen } from "./screens/page-screens";
import { pageEntity } from "./table";

// Admin-Authoring läuft als TenantAdmin (self-service) oder SystemAdmin
// (app-weite Pages). Spiegelt set.write's ACL — Apps mit eigenem Rollen-
// Alias (publicstatus = "Admin") müssen TenantAdmin granten/mappen.
const ADMIN_ACCESS = { roles: ["TenantAdmin", "SystemAdmin"] } as const;

// 60s-shared-cache saves the origin-revalidate roundtrip; CMS edits are live within 60s.
const PUBLIC_PAGE_CACHE = { kind: "revalidate", maxAgeSeconds: 60 } as const;

// QN-Konstante als dokumentierter Public-Contract — der Render-Pfad ruft
// die by-slug-Query via internem app.fetch (kein Code-Import des Handlers,
// symmetrisch zum legal-pages-Muster).
const BY_SLUG_QN = "managed-pages:query:by-slug";

// Wire-Body-Shape von /api/query — das was bySlugQuery returnt (published-only).
type ByslugQueryBody = {
  data: {
    title: string;
    body: string;
    lang: string;
    description: string | null;
    ogImage: string | null;
    version: number;
    updatedAt: string;
  } | null;
};

function brandingRevisionSeed(branding: BrandingTokens): string {
  return JSON.stringify([
    branding.title,
    branding.description,
    branding.siteUrl,
    branding.accentColor,
    branding.logoUrl,
    branding.layoutPreset,
    branding.customCss,
  ]);
}

// Parse the branding query's `{ data }` envelope into BrandingTokens, never
// throwing: a non-ok status or malformed body degrades to the unbranded
// default (branding is decoration, not a hard dependency of the page render).
async function readBrandingResponse(res: Response): Promise<BrandingTokens> {
  if (!res.ok) return EMPTY_BRANDING;
  try {
    const body: { data?: unknown } = await res.json();
    return coerceBranding(body.data);
  } catch {
    return EMPTY_BRANDING;
  }
}

export type ManagedPagesWrapLayout = (opts: {
  readonly title: string;
  readonly bodyHtml: string;
  readonly lang: string;
  readonly slug: string;
  readonly description: string | null;
  readonly ogImage: string | null;
  // Per-tenant branding tokens resolved at render time (accent color, logo,
  // layout preset, …). A custom wrapLayout may apply them however it likes;
  // the default skeleton emits scoped :root vars + a logo/title header.
  readonly branding: BrandingTokens;
}) => string;

export type ManagedPagesOptions = {
  /** Host → tenantId für anonyme per-Tenant-Auslieferung. NULL → 404 (kein
   *  Tenant für diesen Host). Apex-/Marketing-Apps geben hier ihre Subdomain-
   *  /Custom-Domain-Auflösung rein; single-tenant gibt konstant einen
   *  tenantId (oder SYSTEM_TENANT_ID) zurück. Erforderlich, weil der Apex-
   *  Host keinen ambient ctx.tenantId hat. */
  readonly resolveApexTenant: (host: string) => Promise<string | null> | string | null;
  /** Custom Layout-Wrapper (Branding/Chrome). Default: minimaler
   *  page-render-Skeleton. Erhält slug + SEO-Meta zur freien Nutzung.
   *  **`branding` ist RAW, untrusted tenant input.** `title`/`description`
   *  sind am Write nur längen-gecappt, NICHT HTML-escaped; `customCss` ist
   *  ungesanitet. Der Wrapper MUSS sie über die Boundary-Helper emittieren
   *  (alle re-exported von `@cosmicdrift/kumiko-bundled-features/managed-pages`):
   *  `brandingHeaderHtml(branding)` + `brandingStyleBlock(branding)` (escapen
   *  Header/Theme) und — mit allowCustomCss — `tenantStyleBlock(branding.
   *  customCss)` ins `<head>` plus `TENANT_CONTENT_ATTR` am Body-Container. Ein
   *  Custom-Wrapper der `branding.title` selbst interpoliert ist stored XSS;
   *  der Default-Wrapper nutzt durchweg die Helper. */
  readonly wrapLayout?: ManagedPagesWrapLayout;
  /** Basis-Pfad der Page-Routes. Default "/p" → GET /p/:slug. */
  readonly basePath?: string;
  /** Default-Sprache wenn `?lang=` fehlt. Default "en". */
  readonly defaultLang?: string;
  /** Aktiviert die per-Tenant Custom-CSS-Capability (raw, untrusted): ein
   *  `branding-custom-css` Config-Key + ein CSS-Feld im Branding-Editor + die
   *  Render-Emission als scoped, allowlist-sanitized `<style data-tenant-css>`.
   *  Default **false** (fail-closed — opt-in für untrusted-Tenant-Input). Auch
   *  wenn true, wird die Emission zusätzlich per-Tenant über das
   *  `managed-pages-css`-Toggle (createManagedPagesCssFeature) gegated, sobald
   *  ein feature-toggles/tier-engine-Runtime verdrahtet ist. Der Render-time-
   *  Sanitizer (page-render/css-sanitize) ist der Safety-Boundary. */
  readonly allowCustomCss?: boolean;
};

// managed-pages — vom Tenant editierbare, server-gerenderte Public-Pages.
// Generalisiert das legal-pages-Render-Muster: eine dynamische Slug-Route
// (`GET /p/:slug`), die den Tenant aus dem Host auflöst (resolveApexTenant),
// die published Page lädt, Markdown gehärtet rendert (page-render) und über
// einen optionalen wrapLayout in Chrome legt. Drafts → 404. Per-Tenant-
// Content wird per `Vary: Host` cache-isoliert.
//
// Admin-Authoring: registriert entityList + entityEdit für `page` (TenantAdmin/
// SystemAdmin) + die Convention-CRUD-Handler die der Renderer per Konvention
// dispatcht. Die Screens MÜSSEN hier liegen (Boot-Validator verlangt entity-Ref
// same-feature); Nav/Workspace bleibt App-Sache.
//
// Voraussetzungen am App-Bootstrap:
//   • anonymousAccess so verdrahtet, dass der X-Tenant-Header honoriert wird
//     — Multi-Tenant nutzt einen tenantResolver (oder keinen defaultTenantId).
//     Ein fixer defaultTenantId lockt Single-Tenant und lehnt den per-Page
//     gesetzten X-Tenant mit 400 tenant_mismatch ab.
//   • Admin-UI: die App zeigt via `r.nav({ screen: "managed-pages:screen:
//     page-list" })` + Workspace-Eintrag auf die hier deklarierten Screens
//     (cross-feature Nav→Screen ist global-validiert) und grantet ihren Admins
//     TenantAdmin. Ohne Nav bleiben die Screens dormant — kein Leak in
//     flat-nav-Apps die managed-pages nur zum Public-Render nutzen.
export function createManagedPagesFeature(opts: ManagedPagesOptions): FeatureDefinition {
  const wrapLayout: ManagedPagesWrapLayout =
    opts.wrapLayout ??
    ((o) =>
      wrapInLayout({
        title: o.title,
        bodyHtml: o.bodyHtml,
        lang: o.lang,
        description: o.description,
        branding: o.branding,
      }));
  const basePath = opts.basePath ?? "/p";
  const defaultLang = opts.defaultLang ?? "en";
  const allowCustomCss = opts.allowCustomCss ?? false;

  return defineFeature("managed-pages", (r) => {
    r.describe(
      "Tenant-editable, server-rendered public pages with per-tenant branding. Stores one Markdown `page` per `(tenantId, slug, lang)` in the `read_pages` entity table with a `published` gate plus `description`/`ogImage` SEO meta. Registers an anonymous `GET {basePath}/:slug` route that resolves the tenant from the request Host via the app-supplied `resolveApexTenant`, serves only published pages (drafts → 404), renders Markdown through the hardened `page-render` core, and isolates per-tenant content with `Vary: Host`. Ships TenantAdmin/SystemAdmin admin screens (`entityList` + `entityEdit`) backed by convention CRUD handlers (`managed-pages:write:page:{create,update,delete}`, `managed-pages:query:page:{list,detail}`); the app wires nav/workspace onto `managed-pages:screen:page-list`. Branding (via `config`, scope tenant): `branding-{title,description,site-url,accent-color,logo-url,layout-preset}` keys with write-time validation (hex color, https URLs), a `configEdit` self-service screen (`managed-pages:screen:branding-settings`), and a `managed-pages:query:branding` read that the render path applies as scoped `:root` CSS vars + a logo/title header. Also exposes `managed-pages:write:set` (idempotent slug-keyed upsert, SystemAdmin cross-tenant via `tenantIdOverride`) as a provisioning API. Requires `config` + `anonymousAccess` wired at app bootstrap.",
    );
    r.uiHints({
      displayLabel: "Managed Pages · Public CMS",
      category: "content",
      recommended: false,
    });
    r.requires("config");
    r.entity("page", pageEntity);

    // Per-tenant branding config keys (scope: tenant). Write-validated via
    // keyDef.pattern (hex / https) — see branding.ts. read:all so the
    // anonymous render path may resolve them. The raw-CSS key is added only
    // when allowCustomCss (fail-closed: no key/editor when the capability off).
    r.config({ keys: allowCustomCss ? { ...BRANDING_KEYS, ...CUSTOM_CSS_KEY } : BRANDING_KEYS });

    const handlers = { set: r.writeHandler(setWrite) };
    const queries = {
      bySlug: r.queryHandler(bySlugQuery),
      branding: r.queryHandler(createBrandingQuery({ allowCustomCss })),
    };

    // Convention-CRUD hinter den Admin-Screens: entityEdit/entityList
    // dispatchen per Konvention `managed-pages:write:page:{create,update,
    // delete}` + `managed-pages:query:page:{list,detail}`. `set` (oben)
    // wird davon NICHT genutzt und bleibt als Provisioning-API erhalten.
    r.writeHandler(defineEntityCreateHandler("page", pageEntity, { access: ADMIN_ACCESS }));
    r.writeHandler(defineEntityUpdateHandler("page", pageEntity, { access: ADMIN_ACCESS }));
    r.writeHandler(defineEntityDeleteHandler("page", pageEntity, { access: ADMIN_ACCESS }));
    r.queryHandler(defineEntityListHandler("page", pageEntity, { access: ADMIN_ACCESS }));
    r.queryHandler(defineEntityDetailHandler("page", pageEntity, { access: ADMIN_ACCESS }));

    r.screen(pageListScreen);
    r.screen(pageEditScreen);
    r.screen(createBrandingSettingsScreen({ allowCustomCss }));

    r.translations({ keys: MANAGED_PAGES_I18N });

    r.httpRoute({
      method: "GET",
      path: `${basePath}/:slug`,
      anonymous: true,
      handler: async (c, { app }) => {
        // `param("slug")` ist string|undefined, weil `path` ein computed
        // Template ist (Hono inferiert `:slug` nur aus String-Literalen).
        const slug = c.req.param("slug");
        if (!slug) return c.text("not found", 404);
        const lang = c.req.query("lang") || defaultLang;
        const url = new URL(c.req.url);
        // Host-Header zuerst (prod hinter Proxy), URL-Host als Fallback.
        const host = c.req.header("host") ?? url.host;

        const tenantId = await opts.resolveApexTenant(host);
        if (!tenantId) return c.text("not found", 404);

        const queryHeaders = { "content-type": "application/json", "X-Tenant": tenantId };
        const queryUrl = `${url.origin}/api/query`;
        const queryReq = (type: string, payload: unknown) =>
          app.fetch(
            new Request(queryUrl, {
              method: "POST",
              headers: queryHeaders,
              body: JSON.stringify({ type, payload }),
            }),
          );

        // Page + branding read in parallel (same in-process app, same
        // X-Tenant). Branding is decoration → a failed/empty branding read
        // degrades to the unbranded default, it never blocks the page.
        const [pageRes, brandingRes] = await Promise.all([
          queryReq(BY_SLUG_QN, { slug, lang }),
          queryReq(BRANDING_QUERY_QN, {}),
        ]);
        if (!pageRes.ok) return c.text("page unavailable", 503);

        const body: ByslugQueryBody = await pageRes.json();
        const data = body.data;
        if (!data) return c.text("not found", 404);

        const branding = await readBrandingResponse(brandingRes);

        const etag = computeRevisionEtag([
          tenantId,
          slug,
          lang,
          String(data.version),
          data.updatedAt,
          brandingRevisionSeed(branding),
        ]);
        const pageHeaders = {
          "content-type": "text/html; charset=utf-8",
          vary: "Host",
        } as const;
        // 304 (Revision unverändert) und HEAD überspringen beide das
        // Markdown-Rendern — der Body wird ohnehin verworfen.
        if (etagMatches(c.req.raw.headers.get("if-none-match"), etag) || c.req.method === "HEAD") {
          return cachedSecurePageResponse(c.req.raw, {
            body: null,
            etag,
            cache: PUBLIC_PAGE_CACHE,
            extra: pageHeaders,
          });
        }

        const html = wrapLayout({
          title: data.title,
          bodyHtml: renderSafeMarkdown(data.body),
          lang: data.lang,
          slug,
          description: data.description,
          ogImage: data.ogImage,
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
