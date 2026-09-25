// @runtime test
// Assert-E2E for use-all-bundled MFA login (Plan: optional-uab-mfa-assert).
// Mirrors the adminMfaLoginChallenge flow: enroll via write-dispatch, drive
// the Login→MfaVerify gate swap, assert shell access. Screenshots stay
// Docs-only. Disables MFA in finally so a repeat run of this same spec
// never inherits an already-enabled factor.
//
// Runs against its own seedTenant() tenant/user (server.ts mounts
// createE2eSeedRoutes()), not the shared ADMIN_EMAIL account or a second
// fixed account: enabling/disabling MFA mid-test mutates that account's
// login state, which raced cap-overview.spec.ts logging in as admin once
// e2e went parallel-by-default (#3121) — and, with a second fixed account,
// raced concurrent instances of this very spec under --repeat-each. A
// tenant (and account) per run removes both races the same way every other
// flow's shared-state race is removed.
//
// Shell assert uses the UserMenu trigger (own display name), not the
// tenant switcher — a seedTenant() user belongs to exactly one tenant, so
// TenantSwitcher (single-tenant apps need no switcher) never renders one.
// Not /profile either — with admin-shell workspaces the first URL segment
// is the workspace id, so bare `/profile` is not a screen path.

import { base32Decode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { currentTotpCode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/testing";
import { expect, test } from "@cosmicdrift/kumiko-testing/e2e";
import type { Page } from "@playwright/test";

const DISPLAY_NAME = "MFA E2E";

async function csrfFrom(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === "kumiko_csrf")?.value ?? "";
}

async function expectShell(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: DISPLAY_NAME })).toBeVisible({
    timeout: 10_000,
  });
}

async function disableMfa(page: Page, code: string): Promise<void> {
  const csrf = await csrfFrom(page);
  const res = await page.request.post("/api/write", {
    headers: { "X-CSRF-Token": csrf },
    data: {
      type: "auth-mfa:write:disable",
      payload: { code },
    },
  });
  if (!res.ok()) {
    const body = await res.text();
    if (!/mfa_not_enabled|not.?enabled/i.test(body)) {
      throw new Error(`MFA disable failed: ${res.status()} ${body}`);
    }
  }
}

async function ensureSessionForDisable(
  page: Page,
  email: string,
  password: string,
  secret: Buffer,
): Promise<void> {
  if (
    await page
      .getByRole("button", { name: DISPLAY_NAME })
      .isVisible()
      .catch(() => false)
  ) {
    return;
  }

  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const codeField = page.getByLabel("Code");
  if (await codeField.isVisible().catch(() => false)) {
    await codeField.fill(currentTotpCode(secret));
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/auth/mfa/verify") && r.ok(), {
        timeout: 10_000,
      }),
      page.getByRole("button", { name: /Verify|Bestätigen/i }).click(),
    ]);
  }
  await expectShell(page);
}

test("MFA enable → logout → login challenges → TOTP → shell", async ({ page, seedTenant }) => {
  const tenant = await seedTenant({ admin: { displayName: DISPLAY_NAME } });
  const { email, password } = tenant.admin;
  let secret: Buffer | undefined;
  let recoveryCode: string | undefined;
  let enrolled = false;

  try {
    await tenant.loginAs(page, tenant.admin);
    await expectShell(page);

    const csrfToken = await csrfFrom(page);
    const start = await page.request.post("/api/write", {
      headers: { "X-CSRF-Token": csrfToken },
      data: {
        type: "auth-mfa:write:enable-start",
        payload: { accountLabel: email },
      },
    });
    expect(start.ok()).toBe(true);
    const startBody = (await start.json()) as {
      data: { setupToken: string; otpauthUri: string; recoveryCodes: string[] };
    };
    const secretParam =
      new URLSearchParams(startBody.data.otpauthUri.split("?")[1]).get("secret") ?? "";
    secret = base32Decode(secretParam);
    recoveryCode = startBody.data.recoveryCodes[0];
    expect(recoveryCode).toBeTruthy();

    const confirm = await page.request.post("/api/write", {
      headers: { "X-CSRF-Token": csrfToken },
      data: {
        type: "auth-mfa:write:enable-confirm",
        payload: {
          setupToken: startBody.data.setupToken,
          code: currentTotpCode(secret),
        },
      },
    });
    expect(confirm.ok()).toBe(true);
    enrolled = true;

    await page.context().clearCookies();
    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByLabel("Code")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Code").fill(currentTotpCode(secret));
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/auth/mfa/verify") && r.ok(), {
        timeout: 10_000,
      }),
      page.getByRole("button", { name: /Verify|Bestätigen/i }).click(),
    ]);

    await expectShell(page);
  } finally {
    // Recovery code avoids TOTP replay rejection after the login verify.
    if (enrolled && secret && recoveryCode) {
      await ensureSessionForDisable(page, email, password, secret);
      await disableMfa(page, recoveryCode);
    }
  }
});
