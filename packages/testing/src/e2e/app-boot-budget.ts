import type { BrowserContext } from "@playwright/test";

// Duplicated from kumiko-renderer (APP_SCHEMA_API_PATH): kumiko-testing does not depend on the renderer.
export const APP_SCHEMA_API_PATH = "/api/schema";

export const DEFAULT_MAX_APP_BOOTS_PER_TEST = 8;

// Every app boot fetches the schema once, so the request count is the number of page loads.
export function observeAppBoots(context: Pick<BrowserContext, "on">): {
  readonly count: () => number;
} {
  let bootCount = 0;
  context.on("request", (request) => {
    if (new URL(request.url()).pathname === APP_SCHEMA_API_PATH) bootCount += 1;
  });
  return { count: () => bootCount };
}

export function appBootBudgetViolation(bootCount: number, maxBoots: number): string | undefined {
  if (bootCount <= maxBoots) return undefined;
  return `This test booted the app ${bootCount} times (GET ${APP_SCHEMA_API_PATH}), budget is ${maxBoots}. Seed through tenant.api instead of page.goto per seed; each page.goto reloads the app. Specs that navigate on purpose (screenshot scenarios) raise the budget with test.use({ maxAppBootsPerTest }).`;
}
