import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { scanTemplateDrift } from "../guard-test-template-drift";

function sourceFileAt(path: string, code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(path, code);
}

describe("scanTemplateDrift", () => {
  test("flags a Playwright config that builds its own defineConfig", () => {
    const sf = sourceFileAt(
      "/private/repo/packages/app/playwright.screenshots.config.ts",
      'import { defineConfig } from "@playwright/test";\nexport default defineConfig({ use: { baseURL: "http://localhost" } });\n',
    );
    const findings = scanTemplateDrift(sf, []);
    expect(findings.some((f) => /own defineConfig/.test(f.message))).toBe(true);
  });

  test("does not flag a Playwright config that calls defineAppE2eConfig", () => {
    const sf = sourceFileAt(
      "/private/repo/packages/app/playwright.config.ts",
      'import { defineAppE2eConfig } from "@cosmicdrift/kumiko-testing/e2e";\nexport default defineAppE2eConfig({ port: 4321 });\n',
    );
    const findings = scanTemplateDrift(sf, []);
    expect(findings).toEqual([]);
  });

  test("flags a defineAppE2eConfig-based config that still overrides viewport on the returned use block", () => {
    const sf = sourceFileAt(
      "/private/repo/packages/app/playwright.config.ts",
      'import { defineAppE2eConfig } from "@cosmicdrift/kumiko-testing/e2e";\n' +
        "const config = defineAppE2eConfig({ port: 4321 });\n" +
        "export default { ...config, use: { ...config.use, viewport: { width: 1920, height: 1080 } } };\n",
    );
    const findings = scanTemplateDrift(sf, []);
    expect(findings.some((f) => /Literal "viewport"/.test(f.message))).toBe(true);
  });

  test("flags a literal deviceScaleFactor in a spec's test.use(...), but not the sibling viewport", () => {
    const sf = sourceFileAt(
      "/private/repo/packages/app/e2e/screenshots.spec.ts",
      'import { test } from "@playwright/test";\ntest.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });\n',
    );
    const findings = scanTemplateDrift(sf, []);
    const literalFindings = findings.filter((f) => /Literal "/.test(f.message));
    expect(literalFindings).toHaveLength(1);
    expect(literalFindings[0]?.message).toContain('Literal "deviceScaleFactor"');
  });

  test("does not flag a spec's own test.use({ viewport }) — the documented way to assert a sub-1920px layout", () => {
    const sf = sourceFileAt(
      "/private/repo/packages/app/e2e/table-overflow-mobile.spec.ts",
      'import { test } from "@playwright/test";\ntest.use({ viewport: { width: 390, height: 844 } });\n',
    );
    const findings = scanTemplateDrift(sf, []);
    expect(findings.some((f) => /Literal "/.test(f.message))).toBe(false);
  });

  test("flags a literal viewport in a playwright config's project use", () => {
    const sf = sourceFileAt(
      "/private/repo/packages/app/playwright.config.ts",
      'import { defineConfig } from "@playwright/test";\n' +
        'export default defineConfig({ projects: [{ name: "narrow", use: { viewport: { width: 390, height: 844 } } }] });\n',
    );
    const findings = scanTemplateDrift(sf, []);
    expect(findings.some((f) => /Literal "viewport"/.test(f.message))).toBe(true);
  });

  test("does not flag a viewport key on an app-owned scenario object outside test.use/config use (e.g. runMatrix's Scenario.viewport)", () => {
    const sf = sourceFileAt(
      "/private/repo/packages/app/e2e/screenshots/scenarios.ts",
      "const VIEWPORT = { width: 1920, height: 1080 };\n" +
        'export const scenarios = [{ name: "home", viewport: VIEWPORT }];\n',
    );
    const findings = scanTemplateDrift(sf, []);
    expect(findings.some((f) => /Literal "/.test(f.message))).toBe(false);
  });

  test("does not flag a ...devices[...] spread (device-matrix projects stay allowed)", () => {
    const sf = sourceFileAt(
      "/private/repo/packages/app/playwright.screenshots.config.ts",
      'import { defineConfig, devices } from "@playwright/test";\n' +
        'export default defineConfig({ projects: [{ name: "phone", use: { ...devices["iPhone 13"] } }] });\n',
    );
    const findings = scanTemplateDrift(sf, []);
    expect(findings.some((f) => /Literal "/.test(f.message))).toBe(false);
  });

  test("flags a direct page.screenshot(...) call", () => {
    const sf = sourceFileAt(
      "/private/repo/packages/app/e2e/_helpers/shot.ts",
      'import type { Page } from "@playwright/test";\n' +
        'export const shot = async (page: Page) => { await page.screenshot({ path: "out.png" }); };\n',
    );
    const findings = scanTemplateDrift(sf, []);
    expect(findings.some((f) => /Direct page\.screenshot/.test(f.message))).toBe(true);
  });

  test("does not flag packages/testing itself", () => {
    const sf = sourceFileAt(
      "/private/repo/packages/testing/src/e2e/screenshots.ts",
      'import type { Page } from "@playwright/test";\n' +
        "export const captureScreenshot = async (page: Page) => { await page.screenshot({}); };\n",
    );
    const findings = scanTemplateDrift(sf, []);
    expect(findings).toEqual([]);
  });

  test("does not flag samples/recipes", () => {
    const sf = sourceFileAt(
      "/private/repo/samples/recipes/e2e/shot.ts",
      'import type { Page } from "@playwright/test";\n' +
        "export const shot = async (page: Page) => { await page.screenshot({}); };\n",
    );
    const findings = scanTemplateDrift(sf, []);
    expect(findings).toEqual([]);
  });

  test("an exception marker on the line above suppresses the finding", () => {
    const sf = sourceFileAt(
      "/private/repo/packages/app/e2e/_helpers/shot.ts",
      'import type { Page } from "@playwright/test";\n' +
        "export const shot = async (page: Page) => {\n" +
        "  // @template-drift-exception: #3118 handbook screenshot, not covered by captureScreenshot's fit modes\n" +
        '  await page.screenshot({ path: "out.png" });\n' +
        "};\n",
    );
    const findings = scanTemplateDrift(sf, []);
    expect(findings).toEqual([]);
  });

  test("an incomplete exception marker still flags, with a note", () => {
    const sf = sourceFileAt(
      "/private/repo/packages/app/e2e/_helpers/shot.ts",
      'import type { Page } from "@playwright/test";\n' +
        "export const shot = async (page: Page) => {\n" +
        "  // @template-drift-exception: TODO\n" +
        '  await page.screenshot({ path: "out.png" });\n' +
        "};\n",
    );
    const findings = scanTemplateDrift(sf, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("incomplete");
  });
});
