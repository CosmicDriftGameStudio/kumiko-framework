import { requireTextContent, type TextContentApi } from "@kumiko/bundled-features/text-content";
import { defineFeature, type FeatureDefinition, SYSTEM_TENANT_ID } from "@kumiko/framework/engine";
import { LEGAL_REQUIRED_BLOCKS, LEGAL_ROUTES } from "./constants";
import { renderMarkdownToHtml, wrapInLayout } from "./markdown";

// QN-Konstante als dokumentierter Public-Contract des text-content-
// Features. Ein magic-string statt eines Code-Imports ist hier explizit
// gewollt: Cross-Feature-Calls gehen nur über stable Public-API
// (handler-name + payload-shape), nicht über interne Module-Refs. Wenn
// text-content's Handler-Name sich ändert, ist das ein semver-major
// und muss in beiden Features synchronisiert werden — gleiches Risiko
// wie bei jedem API-Endpunkt.
const TEXT_CONTENT_BY_SLUG_QN = "text-content:query:by-slug";

// Wire-Body-Shape von /api/query — das, was bySlugQuery returnt.
type ByslugQueryBody = {
  data: { title: string; body: string | null } | null;
};

// legal-pages — Opt-in-Wrapper um text-content für DACH-Compliance.
// Liefert vier feste Public-HTML-Routes (/legal/impressum,
// /legal/datenschutz, /legal/imprint, /legal/privacy) mit
// Markdown→HTML-Rendering und einen Boot-Check der in Production hart
// fehlt wenn die DE-Pflicht-Blocks nicht geseedet sind.
//
// Cross-Feature-Decoupling:
//   • Routes nutzen app.fetch zu "/api/query" mit dem QN-string
//     `text-content:query:by-slug` — kein Code-Import von text-content
//   • Boot-Check nutzt ctx.textContent (über extraContext) — symmetrisch
//     zum config/tenant-Pattern
//   • Single Type-Import (TextContentApi) bleibt — type-only verstößt
//     nicht gegen Cross-Feature-Coupling
//
// Voraussetzungen für Production:
//   • App-Bootstrap muss extraContext: { textContent: createTextContentApi(db) }
//     setzen — sonst wirft Boot-Check beim Start
//   • anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID } — sonst
//     antworten die Routes mit 503
export function createLegalPagesFeature(): FeatureDefinition {
  return defineFeature("legal-pages", (r) => {
    r.requires("text-content");

    // 4 Public-HTML-Routes
    for (const route of LEGAL_ROUTES) {
      r.httpRoute({
        method: "GET",
        path: route.path,
        anonymous: true,
        handler: async (c, { app }) => {
          const url = new URL(c.req.url);
          const queryRes = await app.fetch(
            new Request(`${url.origin}/api/query`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                host: c.req.header("host") ?? "",
              },
              body: JSON.stringify({
                type: TEXT_CONTENT_BY_SLUG_QN,
                payload: { slug: route.slug, lang: route.lang },
              }),
            }),
          );

          if (!queryRes.ok) {
            return c.text("legal page unavailable", 503);
          }

          const body: ByslugQueryBody = await queryRes.json();
          const data = body.data;
          if (!data || !data.body) {
            return c.text(
              `${route.titleFallback} not configured. Tenant-Admin must set this text-block.`,
              404,
            );
          }

          const html = wrapInLayout({
            title: data.title || route.titleFallback,
            bodyHtml: renderMarkdownToHtml(data.body),
            lang: route.lang,
          });

          return c.body(html, 200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300",
          });
        },
      });
    }

    // Boot-Check via ctx.textContent (extraContext-Pattern, symmetrisch
    // zu requireConfigResolver in config). App-Bootstrap muss textContent
    // wired haben — der Helper gibt einen klaren Wiring-Hinweis wenn nicht.
    r.job(
      "legal-pages-boot-check",
      {
        trigger: { manual: true },
        runOnBoot: true,
        runIn: "api",
      },
      async (_payload, ctx) => {
        const textContent: TextContentApi = requireTextContent(ctx, "legal-pages-boot-check");
        const missing: { slug: string; lang: string }[] = [];

        for (const required of LEGAL_REQUIRED_BLOCKS) {
          const block = await textContent.getBlock({
            tenantId: SYSTEM_TENANT_ID,
            slug: required.slug,
            lang: required.lang,
          });
          if (!block || !block.body) {
            missing.push({ slug: required.slug, lang: required.lang });
          }
        }

        if (missing.length === 0) {
          ctx.log?.info("legal-pages boot-check: alle Pflicht-Blocks vorhanden");
          return;
        }

        const message =
          `legal-pages: missing ${missing.length} required text-block(s) in SYSTEM_TENANT: ` +
          missing.map((m) => `${m.slug}/${m.lang}`).join(", ") +
          ". Seed via text-content:write:set or seedTextBlock helper.";

        if (process.env["NODE_ENV"] === "production") {
          throw new Error(`Boot-Validation failed: ${message}`);
        }
        ctx.log?.warn(message);
      },
    );

    return {};
  });
}
