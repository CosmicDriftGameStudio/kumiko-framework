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
export type LegalPagesWrapLayout = (opts: {
  readonly title: string;
  readonly bodyHtml: string;
  readonly lang: string;
}) => string;

export type LegalPagesOptions = {
  /** Custom Layout-Wrapper für die /legal/*-Routes. Default: minimaler
   *  HTML-Skeleton aus markdown.ts (`wrapInLayout`). Apps die ihr eigenes
   *  Marketing-Layout (Header/Footer/Theme) auch um Legal-Body legen
   *  wollen, übergeben hier ihre Render-Function. */
  readonly wrapLayout?: LegalPagesWrapLayout;
};

export function createLegalPagesFeature(opts: LegalPagesOptions = {}): FeatureDefinition {
  const wrapLayout = opts.wrapLayout ?? wrapInLayout;
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
          // Architektur: 1 App = X Tenants = 1 Impressum. Egal welche
          // Subdomain der Visitor besucht (apex, admin.*, tenant-x.*) —
          // legal-pages serven IMMER die SYSTEM_TENANT-Texte. Deshalb
          // explizit X-Tenant-Header setzen statt host weiterreichen
          // (sonst würde ein host-basierter anonymousAccess-Resolver
          // die tenant-Subdomain auf tenant-tenantId resolven und
          // tenant-x's leere imprint-Tabelle abfragen → 404).
          const queryRes = await app.fetch(
            new Request(`${url.origin}/api/query`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "X-Tenant": SYSTEM_TENANT_ID,
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
          if (!data?.body) {
            return c.text(
              `${route.titleFallback} not configured. Tenant-Admin must set this text-block.`,
              404,
            );
          }

          const html = wrapLayout({
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
    //
    // Body als named function extrahiert (`runLegalPagesBootCheck`) damit
    // die Logik direkt unit-testbar ist statt nur indirekt über Routes.
    // Pattern: thin job-shell ruft testable function — keine Test-Coupling
    // zum JobRunner.
    r.job(
      "legal-pages-boot-check",
      {
        trigger: { manual: true },
        runOnBoot: true,
        runIn: "api",
      },
      async (_payload, ctx) => runLegalPagesBootCheck(ctx),
    );

    return {};
  });
}

// Minimal-shape für die Boot-Check-Logik — nur die Felder die der Check
// braucht. Akzeptiert HandlerContext + AppContext + jeden anderen
// Container der textContent + log mitbringt. Macht den Check direkt
// unit-testbar mit constructed ctx-Objects.
export type LegalPagesBootCheckCtx = {
  readonly textContent?: TextContentApi;
  readonly log?: {
    readonly info?: (msg: string) => void;
    readonly warn?: (msg: string) => void;
  };
};

// Exportiert für direkte Tests. Wirft InternalError wenn ctx.textContent
// nicht gewired ist (Hinweis auf fehlenden extraContext). Wirft Error
// in NODE_ENV=production wenn Pflicht-Blocks fehlen, sonst log.warn.
// Logged log.info wenn alles vorhanden ist (kein silent-skip).
export async function runLegalPagesBootCheck(ctx: LegalPagesBootCheckCtx): Promise<void> {
  const textContent: TextContentApi = requireTextContent(ctx, "legal-pages-boot-check");
  const missing: { slug: string; lang: string }[] = [];

  for (const required of LEGAL_REQUIRED_BLOCKS) {
    const block = await textContent.getBlock({
      tenantId: SYSTEM_TENANT_ID,
      slug: required.slug,
      lang: required.lang,
    });
    if (!block?.body) {
      missing.push({ slug: required.slug, lang: required.lang });
    }
  }

  if (missing.length === 0) {
    ctx.log?.info?.("legal-pages boot-check: alle Pflicht-Blocks vorhanden");
  } else {
    const message =
      `legal-pages: missing ${missing.length} required text-block(s) in SYSTEM_TENANT: ` +
      missing.map((m) => `${m.slug}/${m.lang}`).join(", ") +
      ". Seed via text-content:write:set or seedTextBlock helper.";

    if (process.env["NODE_ENV"] === "production") {
      throw new Error(`Boot-Validation failed: ${message}`);
    }
    ctx.log?.warn?.(message);
  }
}
