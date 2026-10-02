// validateScenarios — the fail-fast guard runMatrix/runScreenshots call
// before registering any Playwright test. Regression (672/1): Scenario's
// url/flow/waitFor fields are all optional (shared across runners with
// different requirements), so a scenario missing waitFor on a url-only
// entry used to only fail at screenshot-time via a timing race, not at
// registration.
//
// Lives outside src/e2e/ on purpose — bunfig.toml excludes **/e2e/**
// from bun test (that tree is Playwright .spec.ts territory).

import { describe, expect, test } from "bun:test";
import { scenarioWaitForTimeout, validateScenarios } from "../e2e/screenshots";
import { E2E_TIMEOUT_MS } from "../e2e/timeouts";

describe("scenarioWaitForTimeout", () => {
  test("a real-provider run waits longer than navigation but fails before the test timeout", () => {
    expect(scenarioWaitForTimeout(false)).toBe(E2E_TIMEOUT_MS.navigation);
    expect(scenarioWaitForTimeout(true)).toBeGreaterThan(E2E_TIMEOUT_MS.navigation);
    expect(scenarioWaitForTimeout(true)).toBeLessThan(E2E_TIMEOUT_MS.real);
  });
});

describe("validateScenarios", () => {
  test("accepts a url scenario with waitFor", () => {
    expect(() => validateScenarios([{ name: "ok", url: "/", waitFor: "main" }])).not.toThrow();
  });

  test("accepts a flow scenario without waitFor (flow owns its own waiting)", () => {
    expect(() => validateScenarios([{ name: "ok", flow: async () => {} }])).not.toThrow();
  });

  test("accepts a flow that takes the seedTenant fixture as its second parameter", () => {
    expect(() =>
      validateScenarios([{ name: "ok", flow: async (_page, _fixtures) => {} }]),
    ).not.toThrow();
  });

  test("rejects a scenario with neither url nor flow", () => {
    expect(() => validateScenarios([{ name: "broken" }])).toThrow(
      /Scenario "broken" needs either url or flow/,
    );
  });

  test("rejects a url scenario without waitFor (timing-race guard)", () => {
    expect(() => validateScenarios([{ name: "racy", url: "/legal/privacy" }])).toThrow(
      /Scenario "racy" uses url without waitFor/,
    );
  });
});
