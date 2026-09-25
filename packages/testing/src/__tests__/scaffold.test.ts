import { describe, expect, test } from "bun:test";
import { renderBunfigFiles, TEST_TIMEOUT_MS } from "../bunfig";
import { renderTestSetup, SCAFFOLD_E2E_PORT, SCAFFOLD_INTEGRATION_PARALLEL } from "../scaffold";

const setup = renderTestSetup({ appName: "my-shop", frameworkVersion: "^0.13.0" });

describe("renderTestSetup", () => {
  test("ships the four bunfigs, e2e wiring and one example per test class", () => {
    expect(Object.keys(setup.files).sort()).toEqual([
      "bunfig.integration.toml",
      "bunfig.real.toml",
      "bunfig.toml",
      "e2e/server.ts",
      "e2e/smoke.spec.ts",
      "playwright.config.ts",
      "src/__tests__/run-config.test.ts",
      "src/__tests__/tasks.integration.test.ts",
    ]);
  });

  test("bunfigs are the shared presets plus the hoisted linker the scaffold always had", () => {
    const shared = renderBunfigFiles({ install: { linker: "hoisted" } });
    for (const [name, content] of Object.entries(shared)) {
      expect(setup.files[name]).toBe(content);
    }
  });

  test("script budgets come from TEST_TIMEOUT_MS", () => {
    expect(setup.scripts["test"]).toBe(
      `bun --config=bunfig.toml test --timeout=${TEST_TIMEOUT_MS.unit} --dots`,
    );
    expect(setup.scripts["test:real"]).toBe(
      `KUMIKO_REAL_PROVIDERS=1 bun --config=bunfig.real.toml test --timeout=${TEST_TIMEOUT_MS.real} real.test.ts`,
    );
    expect(setup.scripts["test:integration"]).toBe(
      `bun kumiko-testing integration --parallel ${SCAFFOLD_INTEGRATION_PARALLEL}`,
    );
    expect(SCAFFOLD_INTEGRATION_PARALLEL).toBeGreaterThanOrEqual(2);
  });

  test("playwright always runs under bun, real-provider e2e is opt-in", () => {
    expect(setup.scripts["e2e"]).toBe("bunx --bun playwright test");
    expect(setup.scripts["e2e:real"]).toBe("KUMIKO_REAL_PROVIDERS=1 bunx --bun playwright test");
  });

  test("devDependencies pin the testing package to the given framework version", () => {
    expect(setup.devDependencies["@cosmicdrift/kumiko-testing"]).toBe("^0.13.0");
    expect(setup.devDependencies["@playwright/test"]).toMatch(/^\^\d+\./);
  });

  test("the e2e config and server use the template entry points with the given port and app", () => {
    expect(setup.files["playwright.config.ts"]).toContain(
      `defineAppE2eConfig({ port: ${SCAFFOLD_E2E_PORT} })`,
    );
    const custom = renderTestSetup({ appName: "my-shop", frameworkVersion: "*", port: 5555 });
    expect(custom.files["playwright.config.ts"]).toContain("port: 5555");
    const server = setup.files["e2e/server.ts"] ?? "";
    expect(server).toContain("createE2eSeedRoutes()");
    expect(server).toContain('"admin@my-shop.local"');
  });

  test("playwright config and e2e files carry the test-runtime directive as first line", () => {
    for (const name of ["playwright.config.ts", "e2e/server.ts", "e2e/smoke.spec.ts"]) {
      expect(setup.files[name]?.split("\n")[0]).toBe("// @runtime test");
    }
  });

  test("the rules cover the three classes, real providers, the timeout marker and seedTenant", () => {
    for (const fragment of [
      "*.integration.test.ts",
      "e2e/*.spec.ts",
      "KUMIKO_REAL_PROVIDERS=1",
      "@timeout-exception",
      "seedTenant",
      "bunx --bun playwright",
      "docs/guides/test-failures.md",
      "docs/guides/testing-standard.md",
    ]) {
      expect(setup.rulesMarkdown).toContain(fragment);
    }
    expect(setup.rulesMarkdown.trimEnd().split("\n").length).toBeLessThanOrEqual(25);
  });
});
