// Pure constants — no framework import. Read both by seed.ts
// (server side, idempotent admin creation) and by the E2E helper
// `e2e/_helpers/login.ts`.
//
// Why separate: e2e specs run in the Playwright worker, which cannot tolerate anything from
// `@cosmicdrift/kumiko-testing/helpers` (pulls in `vitest`) or
// `@cosmicdrift/kumiko-bundled-features/.../testing` (pulls that in too) —
// Vitest's expect redefines Object.prototype symbols and collides
// with Playwright's expect. This file stays import-chain-empty and is the
// only safe shared source for the login strings.

export const ADMIN_EMAIL = "admin@kumiko.dev";
export const ADMIN_PASSWORD = "kumiko-admin";

// Tenant IDs mirrored between server.ts (TenantId cast) and client.tsx
// (plain string for tenantName mapping). Kept centrally here as plain strings
// since this file stays framework-free — server.ts does the
// `as TenantId` cast locally.
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

// Signs the unsubscribe links of the sample's mails; the e2e signs its own links with it.
// A real app reads it from its secret store.
export const UNSUBSCRIBE_SECRET = "ui-walkthrough-unsubscribe-secret-sample-only";
