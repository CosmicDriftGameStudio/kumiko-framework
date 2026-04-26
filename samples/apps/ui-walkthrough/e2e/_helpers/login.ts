// Login-Helper für Sample-E2Es.
//
// Hintergrund: src/server.ts wired `auth: { loginHandler, … }` ein, also
// kein Auto-Mint-JWT mehr auf GET /. Tests müssen sich vor dem ersten
// `page.goto("/")` authentifizieren — sonst rendert der SessionProvider
// den LoginScreen statt der App.
//
// Implementation: POST direkt gegen /api/auth/login. Playwrights
// page.request teilt das Cookie-Jar mit dem page-Context, also landen
// kumiko_auth (HttpOnly-JWT) und kumiko_csrf (JS-lesbar) automatisch im
// Browser. Anschließendes goto("/") bootet als authentifizierter User.
//
// Bewusst NICHT über die Login-Form geklickt: der Auth-Flow selbst hat
// seine eigenen E2Es. Hier wollen wir nur "user ist drin", nicht "Login
// funktioniert".
//
// File-Position: lokal im Sample, nicht in bundled-features. Solange es
// nur einen Consumer gibt (diesen Sample), wäre eine vorzeitige
// Extraktion premature abstraction. Sobald ein zweiter Sample dieselbe
// Logik braucht, kann die Function nach `auth-email-password/testing`
// migrieren.

import type { Page } from "@playwright/test";
// Direkt aus auth-constants — NIEMALS via seed.ts oder bundled-features.
// Diese ziehen `vitest` als transitive dep (framework/testing → vitest)
// und kollidieren mit Playwrights expect über das Object.prototype-
// Symbol $$jest-matchers-object.
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../../src/app/auth-constants";

export async function loginAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`loginAsAdmin: POST /api/auth/login → ${res.status()} ${await res.text()}`);
  }
}
