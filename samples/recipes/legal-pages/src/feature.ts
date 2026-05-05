// Legal-Pages Sample
//
// DACH-Apps (DE/AT/CH) sind verpflichtet ein Impressum (TMG/DDG §5) und
// eine Datenschutzerklärung (DSGVO Art. 13) öffentlich zugänglich zu
// haben. Das ist 1) für jede App identisch und 2) nervig manuell pro
// App neu zu basteln.
//
// Lösung: zwei opt-in bundled-features kombinieren:
//
//  - `text-content`  — generischer Markdown-Text-Container (Entity
//    `text-block` mit slug+lang+title+body, scoped per Tenant). Auch
//    nutzbar für FAQ, About, ToS, Marketing-Snippets — nicht
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
// braucht, muss sein eigenes Routing davorsetzen oder die text-content-
// query mit tenant-specific tenantId nutzen.
//
// Voraussetzungen für Production:
//  - `anonymousAccess` muss in runProdApp/runDevApp konfiguriert sein
//    (defaultTenantId = SYSTEM_TENANT_ID), sonst antworten die
//    legal-pages-Routes mit 503
//  - `extraContext.textContent = createTextContentApi(db)` muss gewired
//    sein, sonst wirft der Boot-Check mit Wiring-Hinweis
//  - Beim ersten Boot müssen die TextBlocks geseedet sein —
//    text-content/seeding `seedTextBlock` oder via API
//    `text-content:write:set` mit TenantAdmin-Token

import {
  createLegalPagesFeature,
  LEGAL_REQUIRED_BLOCKS,
  LEGAL_ROUTES,
} from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import { createTextContentFeature } from "@cosmicdrift/kumiko-bundled-features/text-content";

// Beide Features aktivieren — text-content ist Foundation, legal-pages
// requires sie. r.requires("text-content") greift automatisch im
// legal-pages-Feature.
export const textContentFeature = createTextContentFeature();
export const legalPagesFeature = createLegalPagesFeature();

// Re-exports für Tests + andere Demos
export { LEGAL_REQUIRED_BLOCKS, LEGAL_ROUTES };
