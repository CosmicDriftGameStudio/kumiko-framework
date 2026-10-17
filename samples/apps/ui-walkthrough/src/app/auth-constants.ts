// Reine Konstanten — kein Framework-Import. Wird sowohl von seed.ts
// (server-Seite, idempotent admin-Anlage) als auch vom E2E-Helper
// `e2e/_helpers/login.ts` gelesen.
//
// Warum getrennt: e2e-Specs laufen im Playwright-Worker, der nichts aus
// `@cosmicdrift/kumiko-testing/helpers` (zieht `vitest`) oder
// `@cosmicdrift/kumiko-bundled-features/.../testing` (zieht das ebenfalls) ertragen
// kann — Vitest's expect redefined Object.prototype-Symbole und kollidiert
// mit Playwrights expect. Diese Datei bleibt importchain-leer und ist die
// einzige sichere shared Quelle für die Login-Strings.

export const ADMIN_EMAIL = "admin@kumiko.dev";
export const ADMIN_PASSWORD = "kumiko-admin";

// Tenant-IDs gespiegelt zwischen server.ts (TenantId-Cast) und client.tsx
// (plain string für tenantName-Mapping). Hier zentral als plain strings,
// da diese Datei framework-frei bleibt — server.ts macht den
// `as TenantId`-Cast lokal.
export const DEV_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const BETA_TENANT_ID = "00000000-0000-4000-8000-000000000002";

// Nordlicht Immobilien GmbH: the tenant the document-designer walkthrough runs
// in. Both users are new; the admin above stays untouched.
export const NORDLICHT_TENANT_ID = "00000000-0000-4000-8000-000000000003";
export const NORDLICHT_TENANT_NAME = "Nordlicht Immobilien GmbH";
export const TENANT_ADMIN_EMAIL = "a.berger@nordlicht-immobilien.de";
export const TENANT_ADMIN_PASSWORD = "nordlicht-berger";
export const PLATFORM_ADMIN_EMAIL = "plattform@kumiko.dev";
export const PLATFORM_ADMIN_PASSWORD = "kumiko-plattform";
