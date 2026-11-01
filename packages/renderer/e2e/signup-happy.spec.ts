// SignupScreen happy-path in real Chromium via createPublicSurface.
// jsdom/happy-dom unit tests cover branches; this pins the browser mount
// (public surface + auth client i18n + form submit) against a mocked API.

import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";

test("signup happy-path: email submit → success banner", async ({ page }) => {
  await page.route("**/api/auth/signup-request", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as { email?: string };
    expect(body.email).toBe("new@example.com");
    await route.fulfill({ status: 200, body: "{}" });
  });

  await page.goto("/signup");
  await expect(page.getByText("Create account")).toBeVisible();

  await page.getByLabel(/^Email/).fill("new@example.com");
  await page.getByRole("button", { name: "Send activation link" }).click();

  await expect(page.getByText("Email sent")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send email again" })).toBeVisible();
});

test("signup with self-registration switched off shows the closed notice and no form", async ({
  page,
}) => {
  let signupRequests = 0;
  await page.route("**/api/auth/signup-request", async (route) => {
    signupRequests++;
    await route.fulfill({ status: 200, body: "{}" });
  });
  await page.route("**/api/query", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { enabled: false } }),
    });
  });

  await page.goto("/signup");
  await expect(page.getByText("Sign-up is currently by invitation only.")).toBeVisible();
  await expect(page.getByLabel(/^Email/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send activation link" })).toHaveCount(0);
  expect(signupRequests).toBe(0);
});
