// Reine Konstanten — kein Framework-Import, damit der E2E-Login-Helper
// (Playwright-Worker) sie lesen kann, ohne die vitest-Importchain aus
// `@cosmicdrift/kumiko-framework/testing` mitzuziehen (kollidiert mit
// Playwrights expect über Object.prototype-Symbole).

export const ADMIN_EMAIL = "admin@kumiko.dev";
export const ADMIN_PASSWORD = "kumiko-admin";

// Zwei feste Tenants, damit der TenantSwitcher sichtbar rendert (>1 Tenant).
// Plain strings — server.ts macht den `as TenantId`-Cast lokal.
export const DEV_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const BETA_TENANT_ID = "00000000-0000-4000-8000-000000000002";

// Fixed id of the first seeded note, so the tags-section screenshot can navigate
// straight to /note-edit/<id> (the other seeded notes get minted uuids).
export const DEMO_NOTE_ID = "00000000-0000-4000-8000-00000000d001";
