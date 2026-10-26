// @runtime test
// Docs screenshots of the billing plans screen: the price note under each plan price and the
// plan-switch dialog with the provider's gross recurring price and its tax. Same real server and
// dispatcher as the review gallery; only the mock provider is fake (docs variant, see gallery-features.ts).

import { randomUUID } from "node:crypto";
import { captureScreenshot, expect, pinEnglishLocale, test } from "@cosmicdrift/kumiko-testing/e2e";
import type { APIRequestContext, Page } from "@playwright/test";
import { GALLERY_MOR_PROVIDER, GALLERY_PLAN_PATH } from "../e2e-billing-gallery/gallery-constants";

const DOCS_VIEWPORT = { width: 1440, height: 900 } as const;
const PERIOD_END_ISO = "2027-01-15T00:00:00Z";

async function postSubscriptionCreated(
  request: APIRequestContext,
  tenantId: string,
): Promise<void> {
  const unique = randomUUID();
  const response = await request.post(`/api/subscription/webhook/${GALLERY_MOR_PROVIDER}`, {
    headers: { "stripe-signature": "gallery" },
    data: {
      providerEventId: `evt_${unique}`,
      providerName: GALLERY_MOR_PROVIDER,
      type: "subscription.created",
      tenantId,
      providerCustomerId: `cus_${unique}`,
      providerSubscriptionId: `sub_${unique}`,
      status: "active",
      tier: "starter",
      currentPeriodEnd: PERIOD_END_ISO,
    },
  });
  expect(response.status()).toBe(200);
}

async function openPlans(page: Page): Promise<void> {
  await page.setViewportSize(DOCS_VIEWPORT);
  await page.goto(GALLERY_PLAN_PATH);
  await expect(page.getByTestId("billing-plan-card-starter")).toBeVisible();
}

test("plan cards show the price note under every price", async ({ page, seedTenant }) => {
  await seedTenant({ admin: { email: "price-note-{tenantId}@docs.example" } });
  await pinEnglishLocale(page);
  await openPlans(page);
  await expect(page.getByTestId("billing-plan-card-starter")).toContainText("plus VAT");
  await expect(page.getByTestId("billing-plan-card-pro")).toContainText("plus VAT");
  await captureScreenshot(page, "billing/plan-cards-price-note", { fit: "content" });
});

test("plan switch dialog shows the gross recurring price and its tax", async ({
  page,
  request,
  seedTenant,
}) => {
  const tenant = await seedTenant({ admin: { email: "plan-switch-{tenantId}@docs.example" } });
  expect((await request.post(`/gallery/mor/${tenant.id}`)).status()).toBe(204);
  await postSubscriptionCreated(request, tenant.id);
  await pinEnglishLocale(page);
  await openPlans(page);
  await page.getByTestId("billing-plan-card-pro").getByRole("button").click();
  await expect(page.getByTestId("plan-switch-confirm-dialog")).toBeVisible();
  const summary = page.getByTestId("plan-switch-summary");
  await expect(summary).toContainText("23.68");
  await expect(summary).toContainText("3.78");
  await captureScreenshot(page, "billing/plan-switch-gross", { fit: "content" });
});
