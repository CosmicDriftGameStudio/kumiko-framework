// Reine Konstanten — kein Framework-Import. Wird sowohl von seed.ts
// (server-Seite, idempotent admin-Anlage) als auch vom E2E-Helper
// `e2e/_helpers/login.ts` gelesen.
//
// Warum getrennt: e2e-Specs laufen im Playwright-Worker, der nichts aus
// `@kumiko/framework/testing` (zieht `vitest`) oder
// `@kumiko/bundled-features/.../testing` (zieht das ebenfalls) ertragen
// kann — Vitest's expect redefined Object.prototype-Symbole und kollidiert
// mit Playwrights expect. Diese Datei bleibt importchain-leer und ist die
// einzige sichere shared Quelle für die Login-Strings.

export const ADMIN_EMAIL = "admin@kumiko.dev";
export const ADMIN_PASSWORD = "kumiko-admin";
