// Legal-Pages Sample
//
// DACH-Apps (DE/AT/CH) sind verpflichtet ein Impressum (TMG/DDG §5) und
// eine Datenschutzerklärung (DSGVO Art. 13) öffentlich zugänglich zu
// haben. Das ist 1) für jede App identisch und 2) nervig manuell pro
// App neu zu basteln.
//
// Lösung: zwei opt-in bundled-features kombinieren:
//
//  - `template-resolver` — der Content-Store (Entity `template-resource`,
//    kind `text-block` mit slug+locale+title+content, scoped per Tenant).
//    Auch nutzbar für FAQ, About, ToS, Marketing-Snippets — nicht
//    legal-spezifisch.
//
//  - `legal-pages`   — opt-in-Wrapper darauf, der vier feste Public-
//    Routes (`/legal/impressum`, `/legal/datenschutz`, `/legal/imprint`,
//    `/legal/privacy`) registriert und Markdown→HTML rendered. Plus
//    Boot-Check der in Production hart fehlt wenn die DE-Pflicht-Blocks
//    fehlen.
//
// Tenant-Modell: 1 App = X Tenants = 1 Impressum. Alle Subdomains
// teilen sich die SYSTEM_TENANT_ID-Version. Wer pro-Tenant-Impressums
// braucht, muss sein eigenes Routing davorsetzen oder die by-slug-
// query mit tenant-specific tenantId nutzen.
//
// Voraussetzungen für Production:
//  - `anonymousAccess` muss in runProdApp/runDevApp konfiguriert sein
//    (defaultTenantId = SYSTEM_TENANT_ID), sonst antworten die
//    legal-pages-Routes mit 503
//  - `extraContext.templateResolver = createTemplateResolverApi(db)` muss
//    gewired sein, sonst wirft der Boot-Check mit Wiring-Hinweis
//  - Beim ersten Boot müssen die TextBlocks geseedet sein —
//    template-resolver/seeding `seedTextBlock` oder via API
//    `template-resolver:write:set` mit TenantAdmin-Token

import {
  createLegalPagesFeature,
  LEGAL_REQUIRED_BLOCKS,
  LEGAL_ROUTES,
} from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";

// Beide Features aktivieren — template-resolver ist Foundation, legal-pages
// requires sie. r.requires("template-resolver") greift automatisch im
// legal-pages-Feature.
export const templateResolverFeature = createTemplateResolverFeature();
export const legalPagesFeature = createLegalPagesFeature();

// Re-exports für Tests + andere Demos
export { LEGAL_REQUIRED_BLOCKS, LEGAL_ROUTES };
