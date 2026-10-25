// Pure constants — no framework import, so the E2E login helper
// (Playwright worker) can read them without pulling in the vitest import chain from
// `@cosmicdrift/kumiko-testing/helpers` (collides with
// Playwright's expect via Object.prototype symbols).

export const ADMIN_EMAIL = "admin@kumiko.dev";
export const ADMIN_PASSWORD = "kumiko-admin";

// Zwei feste Tenants, damit der TenantSwitcher sichtbar rendert (>1 Tenant).
// Plain strings — server.ts macht den `as TenantId`-Cast lokal.
export const DEV_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const BETA_TENANT_ID = "00000000-0000-4000-8000-000000000002";

// Fixed id of the first seeded note, so the tags-section screenshot can navigate
// straight to /note-edit/<id> (the other seeded notes get minted uuids).
export const DEMO_NOTE_ID = "00000000-0000-4000-8000-00000000d001";

// Seeded PDF template that the pdf-template-editor spec opens.
export const INVOICE_TEMPLATE_SLUG = "billing:invoice";
