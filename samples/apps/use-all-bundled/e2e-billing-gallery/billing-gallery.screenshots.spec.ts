// @runtime test
// Review gallery for the consent (checkout) and termination (§ 312k) flows:
// one screenshot per meaningful step, written to $SCREENSHOT_DIR as
// <flow>-<step>-<slug>.png. Every flow also asserts its behaviour, so the
// gallery cannot show a state the code does not reach.
//
// Real server, real dispatcher and jobs; the only fakes are the mock billing
// provider and the in-memory mail transport (see ./server.ts). The provider's
// webhook is posted by the spec, echoing the consent id the checkout URL
// carried, the way a real provider echoes its checkout metadata.

import { randomUUID } from "node:crypto";
import { wrapInLayout } from "@cosmicdrift/kumiko-bundled-features/page-render";
import {
  type CapturedMail,
  captureScreenshot,
  expect,
  mailCapture,
  syntheticClientIpFor,
  test,
} from "@cosmicdrift/kumiko-testing/e2e";
import type { APIRequestContext, Page } from "@playwright/test";
import {
  GALLERY_APEX_HOST,
  GALLERY_OPERATOR_EMAIL,
  GALLERY_PLAN_PATH,
  GALLERY_PROVIDER,
} from "./gallery-constants";

const CONFIRMATION_SUBJECT = /Vertragsbestätigung/;
const DECLARANT_NAME = "Mara Beispiel";

function apexUrl(baseURL: string | undefined, path: string): string {
  if (baseURL === undefined) throw new Error("the Playwright config has no baseURL");
  const url = new URL(path, baseURL);
  url.hostname = GALLERY_APEX_HOST;
  return url.toString();
}

async function shot(page: Page, name: string): Promise<void> {
  await captureScreenshot(page, name, { fit: "content" });
}

// Renders a captured mail inside the same public-page layout the /legal pages
// use; the mail's own HTML document goes into an iframe so its <html>/<style>
// stay isolated from the frame.
async function shotMail(page: Page, name: string, mail: CapturedMail): Promise<void> {
  const frame = `<iframe title="mail" style="width:100%;height:760px;border:1px solid #d4d4d8;border-radius:6px;background:#fff" srcdoc="${mail.html
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")}"></iframe>`;
  const meta = `<p><strong>An:</strong> ${escapeText(mail.to)}<br><strong>Betreff:</strong> ${escapeText(mail.subject)}</p>`;
  await page.setContent(
    wrapInLayout({ title: "Mail-Vorschau", bodyHtml: `${meta}${frame}`, lang: "de" }),
  );
  await shot(page, name);
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

type WebhookEvent = {
  readonly tenantId: string;
  readonly tier: string;
  readonly consentId?: string;
};

type PostedSubscription = {
  readonly providerCustomerId: string;
  readonly providerSubscriptionId: string;
};

const PERIOD_END_ISO = "2027-01-15T00:00:00Z";

async function postSubscriptionEvent(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await request.post(`/api/subscription/webhook/${GALLERY_PROVIDER}`, {
    headers: { "stripe-signature": "gallery" },
    data: { providerEventId: `evt_${randomUUID()}`, providerName: GALLERY_PROVIDER, ...body },
  });
  expect(response.status()).toBe(200);
}

async function postSubscriptionCreated(
  request: APIRequestContext,
  event: WebhookEvent,
): Promise<PostedSubscription> {
  const unique = randomUUID();
  const posted = {
    providerCustomerId: `cus_${unique}`,
    providerSubscriptionId: `sub_${unique}`,
  };
  await postSubscriptionEvent(request, {
    type: "subscription.created",
    tenantId: event.tenantId,
    ...(event.consentId !== undefined && { consentId: event.consentId }),
    ...posted,
    status: "active",
    tier: event.tier,
    currentPeriodEnd: PERIOD_END_ISO,
  });
  return posted;
}

// Mirrors what a real provider sends after a period-end cancellation.
async function postSubscriptionCancelScheduled(
  request: APIRequestContext,
  event: WebhookEvent & PostedSubscription,
): Promise<void> {
  await postSubscriptionEvent(request, {
    type: "subscription.updated",
    tenantId: event.tenantId,
    providerCustomerId: event.providerCustomerId,
    providerSubscriptionId: event.providerSubscriptionId,
    status: "active",
    tier: event.tier,
    currentPeriodEnd: PERIOD_END_ISO,
    cancelAt: PERIOD_END_ISO,
  });
}

async function openPlans(page: Page): Promise<void> {
  await page.goto(GALLERY_PLAN_PATH);
  await expect(page.getByTestId("billing-plan-card-starter")).toBeVisible();
}

async function startCheckout(page: Page): Promise<void> {
  await page.getByTestId("billing-plan-card-starter").getByRole("button").click();
  await expect(page.getByTestId("checkout-consent-dialog")).toBeVisible();
}

async function tickBothConsents(page: Page): Promise<void> {
  await page.locator("#consent-early-performance").check();
  await page.locator("#consent-withdrawal-loss").check();
}

// Public pages bucket by client IP (5 per 10 minutes); a fresh key per test
// keeps reruns against a shared Redis out of an earlier run's bucket.
async function useOwnClientIp(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": syntheticClientIpFor(randomUUID()) });
}

async function fillDeclaration(page: Page, email: string): Promise<void> {
  await page.locator('input[name="name"]').fill(DECLARANT_NAME);
  await page.locator('input[name="email"]').fill(email);
}

test.describe.configure({ mode: "serial" });

test("flows 1-3: checkout with consent, confirmation mail, account cancellation", async ({
  page,
  request,
  seedTenant,
}) => {
  const tenant = await seedTenant({ admin: { email: "buyer-{tenantId}@gallery.example" } });

  await openPlans(page);
  await shot(page, "01-01-plans-panel");

  await startCheckout(page);
  await expect(page.getByTestId("checkout-consent-order")).toBeDisabled();
  await shot(page, "01-02-consent-dialog-unchecked");

  await tickBothConsents(page);
  await expect(page.getByTestId("checkout-consent-order")).toBeEnabled();
  await shot(page, "01-03-consent-dialog-checked");

  await page.getByTestId("checkout-consent-order").click();
  await page.waitForURL(/consentId=/);
  const consentId = new URL(page.url()).searchParams.get("consentId");
  expect(consentId).not.toBeNull();
  const subscription = await postSubscriptionCreated(request, {
    tenantId: tenant.id,
    tier: "starter",
    ...(consentId !== null && { consentId }),
  });
  await openPlans(page);
  await expect(page.getByTestId("billing-plans-cancel-contract")).toBeVisible();
  await shot(page, "01-04-subscribed");

  const confirmation = await mailCapture(request, tenant.admin.email, {
    match: (mail) => CONFIRMATION_SUBJECT.test(mail.subject),
  });
  await shotMail(page, "02-01-confirmation-mail", confirmation);

  await openPlans(page);
  await shot(page, "03-01-cancel-button");
  await page.getByTestId("billing-plans-cancel-contract").click();
  await expect(page.getByTestId("cancel-contract-dialog")).toBeVisible();
  await shot(page, "03-02-cancel-dialog-form");
  await page.getByTestId("cancel-contract-continue").click();
  await expect(page.getByTestId("cancel-contract-submit")).toBeVisible();
  await shot(page, "03-03-cancel-dialog-confirm");
  await page.getByTestId("cancel-contract-submit").click();
  await expect(page.getByTestId("cancel-contract-receipt")).toBeVisible();
  await shot(page, "03-04-cancel-dialog-receipt");
  await page.getByTestId("cancel-contract-done").click();
  await expect(page.getByTestId("checkout-consent-dialog")).toBeHidden();
  await postSubscriptionCancelScheduled(request, {
    tenantId: tenant.id,
    tier: "starter",
    ...subscription,
  });
  await openPlans(page);
  await expect(page.getByTestId("billing-plans-panel-cancel-scheduled")).toBeVisible();
  await shot(page, "03-05-panel-after-cancel");

  const receipt = await mailCapture(request, tenant.admin.email, {
    match: (mail) => !CONFIRMATION_SUBJECT.test(mail.subject),
  });
  await shotMail(page, "03-06-cancel-receipt-mail", receipt);
});

test("flow 4: public cancellation pages on the platform host", async ({
  page,
  request,
  seedTenant,
  baseURL,
}) => {
  const tenant = await seedTenant({ admin: { email: "declarant-{tenantId}@gallery.example" } });
  await postSubscriptionCreated(request, { tenantId: tenant.id, tier: "pro" });
  await page.context().clearCookies();
  await useOwnClientIp(page);

  await page.goto(apexUrl(baseURL, "/legal/kuendigen"));
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await shot(page, "04-01-public-form-de");

  await fillDeclaration(page, tenant.admin.email);
  await shot(page, "04-02-public-form-filled-de");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('button[name="step"][value="confirm"]')).toBeVisible();
  await shot(page, "04-03-public-review-de");
  await page.locator('button[name="step"][value="confirm"]').click();
  await expect(page.locator("code")).toBeVisible();
  await shot(page, "04-04-public-receipt-de");

  const receipt = await mailCapture(request, tenant.admin.email);
  await shotMail(page, "04-05-public-receipt-mail-de", receipt);

  await useOwnClientIp(page);
  await page.goto(apexUrl(baseURL, "/legal/cancel"));
  await shot(page, "04-06-public-form-en");
  await fillDeclaration(page, `nobody-${randomUUID()}@gallery.example`);
  await page.locator('button[type="submit"]').click();
  await page.locator('button[name="step"][value="confirm"]').click();
  await expect(page.locator("code")).toBeVisible();
  await shot(page, "04-07-public-receipt-en");

  // An email that matches no contract is routed to the operator, not dropped.
  const operatorNotice = await mailCapture(request, GALLERY_OPERATOR_EMAIL);
  await shotMail(page, "04-08-operator-notice-mail", operatorNotice);
});

test("flow 5: error states", async ({ page, request, seedTenant, baseURL }) => {
  await seedTenant({ admin: { email: "errors-{tenantId}@gallery.example" } });

  // Request shaping, not a mocked dispatcher: the server still decides.
  await page.route("**/api/write", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.type?.endsWith("start-plan-checkout") && body.payload?.consent) {
      await route.continue({
        postData: JSON.stringify({
          ...body,
          payload: {
            ...body.payload,
            consent: {
              ...body.payload.consent,
              earlyPerformanceRequested: false,
              withdrawalLossAcknowledged: false,
            },
          },
        }),
      });
      return;
    }
    await route.fallback();
  });
  await openPlans(page);
  await startCheckout(page);
  await tickBothConsents(page);
  await page.getByTestId("checkout-consent-order").click();
  await expect(page.getByTestId("checkout-consent-error")).toBeVisible();
  await shot(page, "05-01-consent-missing-422");
  await page.unroute("**/api/write");

  await page.context().clearCookies();
  await useOwnClientIp(page);
  await page.goto(apexUrl(baseURL, "/legal/kuendigen"));
  await fillDeclaration(page, `unknown-${randomUUID()}@gallery.example`);
  await page.locator('button[type="submit"]').click();
  await page.locator('button[name="step"][value="confirm"]').click();
  await expect(page.locator("code")).toBeVisible();
  await shot(page, "05-02-unknown-email-identical-receipt");

  const apexForm = await request.get(apexUrl(baseURL, "/legal/cancel"));
  expect(apexForm.status()).toBe(200);
  expect(await apexForm.text()).not.toContain("tenant_required");
  await useOwnClientIp(page);
  await page.goto(apexUrl(baseURL, "/legal/cancel"));
  await shot(page, "05-03-platform-host-page-works");
});
