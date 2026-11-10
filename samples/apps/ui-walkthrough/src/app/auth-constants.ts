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

// Tenants of the print-editor e2e specs. Specs may share a tenant they only read; whatever a test
// writes lives in a tenant no parallel test reads, so no test sees a layout, template or setting
// change mid-run.
export type PrintEditorTenant = {
  readonly tenantId: string;
  readonly tenantKey: string;
  readonly tenantName: string;
  readonly adminEmail: string;
  readonly adminName: string;
};
export const PRINT_EDITOR_PASSWORD = "druckeditor-verwaltung";
export const PRINT_EDITOR_TENANTS = {
  editor: {
    tenantId: "00000000-0000-4000-8000-000000000011",
    tenantKey: "hafenkontor",
    tenantName: "Hafenkontor Verwaltung GmbH",
    adminEmail: "t.brandt@hafenkontor-verwaltung.de",
    adminName: "T. Brandt",
  },
  appearance: {
    tenantId: "00000000-0000-4000-8000-000000000012",
    tenantKey: "werftstrasse",
    tenantName: "Werftstraße Immobilien KG",
    adminEmail: "s.otto@werftstrasse-immobilien.de",
    adminName: "S. Otto",
  },
  applySelected: {
    tenantId: "00000000-0000-4000-8000-000000000013",
    tenantKey: "gartenstadt",
    tenantName: "Gartenstadt Wohnbau eG",
    adminEmail: "m.krause@gartenstadt-wohnbau.de",
    adminName: "M. Krause",
  },
  applyAll: {
    tenantId: "00000000-0000-4000-8000-000000000014",
    tenantKey: "marschland",
    tenantName: "Marschland Hausverwaltung GmbH",
    adminEmail: "j.feddersen@marschland-hausverwaltung.de",
    adminName: "J. Feddersen",
  },
  // Same seed as `editor`. The print-editor tests that save a draft use it, so the parallel tests
  // and specs reading `editor` never see a draft appear mid-test.
  drafts: {
    tenantId: "00000000-0000-4000-8000-000000000015",
    tenantKey: "lotsenhaus",
    tenantName: "Lotsenhaus Verwaltung GmbH",
    adminEmail: "h.lange@lotsenhaus-verwaltung.de",
    adminName: "H. Lange",
  },
} as const satisfies Record<string, PrintEditorTenant>;

// Signs the unsubscribe links of the sample's mails; the e2e signs its own links with it.
// A real app reads it from its secret store.
export const UNSUBSCRIBE_SECRET = "ui-walkthrough-unsubscribe-secret-sample-only";
