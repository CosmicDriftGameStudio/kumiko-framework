// Login helper for the screenshot E2Es. POST directly to /api/auth/login;
// Playwright's page.request shares the cookie jar with the page context, so
// kumiko_auth + kumiko_csrf land in the browser automatically and the following
// goto() boots authenticated. Import straight from auth-constants (framework-
// free) — NEVER via seed/bundled-features, they pull in vitest transitively.

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIENT_IP_HEADER } from "@cosmicdrift/kumiko-testing/e2e";
import { type Cookie, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../../src/app/auth-constants";

// The session screens list every admin session, so the whole run shares one sign-in instead of
// one per Playwright worker: the first worker of a run (same parent runner pid) signs in and
// writes the cookies, the others wait for them. It also keeps the suite far below the login
// limit of 20 requests per minute and IP.
const SHARED_SESSION_FILE = join(tmpdir(), `use-all-bundled-admin-session-${process.ppid}.json`);
// A public documentation address (TEST-NET-3), so "This session" reads like a real sign-in.
const ADMIN_CLIENT_IP = "203.0.113.12";

let adminSessionCookies: readonly Cookie[] | undefined;

function isCookieList(value: unknown): value is Cookie[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "object" && entry !== null && "name" in entry)
  );
}

function readSharedCookies(): readonly Cookie[] | undefined {
  const raw = readFileSync(SHARED_SESSION_FILE, "utf-8");
  if (raw === "") return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (!isCookieList(parsed)) throw new Error(`${SHARED_SESSION_FILE} holds no cookie list`);
  return parsed;
}

async function signInOnce(page: Page): Promise<readonly Cookie[]> {
  try {
    writeFileSync(SHARED_SESSION_FILE, "", { flag: "wx" });
  } catch {
    let shared: readonly Cookie[] | undefined;
    await expect
      .poll(() => {
        shared = readSharedCookies();
        return shared !== undefined;
      })
      .toBe(true);
    if (shared === undefined) throw new Error("shared admin session vanished");
    return shared;
  }
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    headers: { [CLIENT_IP_HEADER]: ADMIN_CLIENT_IP },
  });
  if (!res.ok()) {
    rmSync(SHARED_SESSION_FILE, { force: true });
    throw new Error(`loginAsAdmin: POST /api/auth/login → ${res.status()} ${await res.text()}`);
  }
  const cookies = await page.context().cookies();
  writeFileSync(SHARED_SESSION_FILE, JSON.stringify(cookies));
  return cookies;
}

export async function loginAsAdmin(page: Page): Promise<void> {
  adminSessionCookies ??= await signInOnce(page);
  await page.context().addCookies([...adminSessionCookies]);
}
