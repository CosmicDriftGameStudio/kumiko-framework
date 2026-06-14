import {
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { renderSafeMarkdown, securePageHeaders, wrapInLayout } from "../page-render";
import { bySlugQuery } from "./handlers/by-slug.query";
import { setWrite } from "./handlers/set.write";
import { pageEditScreen, pageListScreen } from "./screens/page-screens";
import { pageEntity } from "./table";

// Admin-Authoring läuft als TenantAdmin (self-service) oder SystemAdmin
// (app-weite Pages). Spiegelt set.write's ACL — Apps mit eigenem Rollen-
// Alias (publicstatus = "Admin") müssen TenantAdmin granten/mappen.
const ADMIN_ACCESS = { roles: ["TenantAdmin", "SystemAdmin"] } as const;

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
  } | null;
};

export type ManagedPagesWrapLayout = (opts: {
  readonly title: string;
  readonly bodyHtml: string;
  readonly lang: string;
  readonly slug: string;
  readonly description: string | null;
  readonly ogImage: string | null;
}) => string;

export type ManagedPagesOptions = {
  /** Host → tenantId für anonyme per-Tenant-Auslieferung. NULL → 404 (kein
   *  Tenant für diesen Host). Apex-/Marketing-Apps geben hier ihre Subdomain-
   *  /Custom-Domain-Auflösung rein; single-tenant gibt konstant einen
   *  tenantId (oder SYSTEM_TENANT_ID) zurück. Erforderlich, weil der Apex-
   *  Host keinen ambient ctx.tenantId hat. */
  readonly resolveApexTenant: (host: string) => Promise<string | null> | string | null;
  /** Custom Layout-Wrapper (Branding/Chrome). Default: minimaler
   *  page-render-Skeleton. Erhält slug + SEO-Meta zur freien Nutzung. */
  readonly wrapLayout?: ManagedPagesWrapLayout;
  /** Basis-Pfad der Page-Routes. Default "/p" → GET /p/:slug. */
  readonly basePath?: string;
  /** Default-Sprache wenn `?lang=` fehlt. Default "en". */
  readonly defaultLang?: string;
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
    ((o) => wrapInLayout({ title: o.title, bodyHtml: o.bodyHtml, lang: o.lang }));
  const basePath = opts.basePath ?? "/p";
  const defaultLang = opts.defaultLang ?? "en";

  return defineFeature("managed-pages", (r) => {
    r.describe(
      "Tenant-editable, server-rendered public pages. Stores one Markdown `page` per `(tenantId, slug, lang)` in the `read_pages` entity table with a `published` gate plus `description`/`ogImage` SEO meta. Registers an anonymous `GET {basePath}/:slug` route that resolves the tenant from the request Host via the app-supplied `resolveApexTenant`, serves only published pages (drafts → 404), renders Markdown through the hardened `page-render` core, and isolates per-tenant content with `Vary: Host`. Ships TenantAdmin/SystemAdmin admin screens (`entityList` + `entityEdit`) backed by convention CRUD handlers (`managed-pages:write:page:{create,update,delete}`, `managed-pages:query:page:{list,detail}`); the app wires nav/workspace onto `managed-pages:screen:page-list`. Also exposes `managed-pages:write:set` (idempotent slug-keyed upsert, SystemAdmin cross-tenant via `tenantIdOverride`) as a provisioning API. Requires `anonymousAccess` wired at app bootstrap.",
    );
    r.entity("page", pageEntity);

    const handlers = { set: r.writeHandler(setWrite) };
    const queries = { bySlug: r.queryHandler(bySlugQuery) };

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

        const queryRes = await app.fetch(
          new Request(`${url.origin}/api/query`, {
            method: "POST",
            headers: { "content-type": "application/json", "X-Tenant": tenantId },
            body: JSON.stringify({ type: BY_SLUG_QN, payload: { slug, lang } }),
          }),
        );
        if (!queryRes.ok) return c.text("page unavailable", 503);

        const body: ByslugQueryBody = await queryRes.json();
        const data = body.data;
        if (!data) return c.text("not found", 404);

        const html = wrapLayout({
          title: data.title,
          bodyHtml: renderSafeMarkdown(data.body),
          lang: data.lang,
          slug,
          description: data.description,
          ogImage: data.ogImage,
        });

        // Vary: Host — per-Tenant-Content darf nicht von einem shared CDN
        // nur unter dem Pfad gecached werden (sonst Tenant A's Page auf
        // Tenant B's Domain). Cache keyed mit auf den Host.
        return c.body(
          html,
          200,
          securePageHeaders({
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300",
            vary: "Host",
          }),
        );
      },
    });

    return { handlers, queries };
  });
}
