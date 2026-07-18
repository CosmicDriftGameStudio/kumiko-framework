// Assert-E2E for use-all-bundled MFA login (Plan: optional-uab-mfa-assert).
// Mirrors e2e/screenshots.spec.ts adminMfaLoginChallenge + kumiko-studio
// mfa-login.spec.ts: enroll via write-dispatch, drive Login→MfaVerify gate
// swap, assert shell access. Screenshots stay Docs-only.
// Disables MFA in finally so retries / later specs keep plain password login.
//
// Shell assert uses the tenant switcher ("Dev Tenant"), not /profile — with
// admin-shell workspaces the first URL segment is the workspace id, so bare
// `/profile` is not a screen path.

import { base32Decode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { currentTotpCode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/testing";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../src/app/auth-constants";
import { loginAsAdmin } from "./_helpers/login";

async function csrfFrom(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === "kumiko_csrf")?.value ?? "";
}

async function expectShell(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Dev Tenant" })).toBeVisible({
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

async function ensureSessionForDisable(page: Page, secret: Uint8Array): Promise<void> {
  if (
    await page
      .getByRole("button", { name: "Dev Tenant" })
      .isVisible()
      .catch(() => false)
  ) {
    return;
  }

  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
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

test("MFA enable → logout → login challenges → TOTP → shell", async ({ page }) => {
  let secret: Uint8Array | undefined;
  let recoveryCode: string | undefined;
  let enrolled = false;

  try {
    await loginAsAdmin(page);
    await expectShell(page);

    const csrfToken = await csrfFrom(page);
    const start = await page.request.post("/api/write", {
      headers: { "X-CSRF-Token": csrfToken },
      data: {
        type: "auth-mfa:write:enable-start",
        payload: { accountLabel: ADMIN_EMAIL },
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
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
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
      await ensureSessionForDisable(page, secret);
      await disableMfa(page, recoveryCode);
    }
  }
});
