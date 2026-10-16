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

import type { Cookie, Page } from "@playwright/test";
// Direkt aus auth-constants — NIEMALS via seed.ts oder bundled-features.
// Diese ziehen `vitest` als transitive dep (framework/testing → vitest)
// und kollidieren mit Playwrights expect über das Object.prototype-
// Symbol $$jest-matchers-object.
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../../src/app/auth-constants";

// The login route allows 20 requests per minute and IP. One login per user and worker keeps
// the suite under that limit; later tests get the same session cookies.
const sessionCookiesByEmail = new Map<string, readonly Cookie[]>();

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  const cachedCookies = sessionCookiesByEmail.get(email);
  if (cachedCookies !== undefined) {
    await page.context().addCookies([...cachedCookies]);
    return;
  }
  const res = await page.request.post("/api/auth/login", { data: { email, password } });
  if (!res.ok()) {
    throw new Error(`loginAs: POST /api/auth/login → ${res.status()} ${await res.text()}`);
  }
  sessionCookiesByEmail.set(email, await page.context().cookies());
}

export const loginAsAdmin = (page: Page): Promise<void> =>
  loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
