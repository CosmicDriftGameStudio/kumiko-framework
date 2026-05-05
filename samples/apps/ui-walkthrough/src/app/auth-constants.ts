// Reine Konstanten — kein Framework-Import. Wird sowohl von seed.ts
// (server-Seite, idempotent admin-Anlage) als auch vom E2E-Helper
// `e2e/_helpers/login.ts` gelesen.
//
// Warum getrennt: e2e-Specs laufen im Playwright-Worker, der nichts aus
// `@cosmicdrift/kumiko-framework/testing` (zieht `vitest`) oder
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
