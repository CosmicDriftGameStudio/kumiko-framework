import { expect, boundaryGuardedTest as test } from "@cosmicdrift/kumiko-testing/e2e";
import { DETAIL_RACE_A_SCREEN_ID } from "./fixtures/detail-race-screens";

// jsdom only sees the settled DOM. Under a throttled CPU the shell breadcrumb h1 and the
// page's own h1 can coexist until the bodyTitle flag has reached the shell header.

type H1Tally = { max: number; zeroAfterFirst: boolean };
type TallyWindow = Window & { __H1_TALLY__?: H1Tally };

test("a detail page never shows two h1 at once, also with a throttled CPU", async ({ page }) => {
  await page.addInitScript(() => {
    const tally: H1Tally = { max: 0, zeroAfterFirst: false };
    (window as TallyWindow).__H1_TALLY__ = tally;
    let seenAny = false;
    new MutationObserver(() => {
      const count = document.querySelectorAll("h1").length;
      tally.max = Math.max(tally.max, count);
      if (count > 0) seenAny = true;
      else if (seenAny) tally.zeroAfterFirst = true;
    }).observe(document, { childList: true, subtree: true });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });

  await page.goto(`/${DETAIL_RACE_A_SCREEN_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Wohnung in Leipzig" })).toBeVisible();
  await page.getByTestId("detail-race-switch").click();
  await expect(page.getByRole("heading", { level: 1, name: "Haus in Dresden" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  const tally = await page.evaluate(() => (window as TallyWindow).__H1_TALLY__);
  expect(tally?.max).toBe(1);
  expect(tally?.zeroAfterFirst).toBe(false);
});
