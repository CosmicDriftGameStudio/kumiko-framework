// @runtime tooling
export type ScaffoldTestStarter = "demo" | "blank";

export const BLANK_E2E_PLAYWRIGHT_FLAG = "--pass-with-no-tests";

export const BLANK_TEST_FILES: Readonly<Record<string, string>> = {
  "src/__tests__/run-config.test.ts": [
    'import { describe, expect, test } from "bun:test";',
    'import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";',
    'import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";',
    'import { APP_FEATURES, HAS_AUTH } from "../run-config";',
    "",
    'describe("run-config", () => {',
    '  test("the mounted features pass boot validation", () => {',
    "    const features = composeFeatures([...APP_FEATURES], { includeBundled: HAS_AUTH });",
    "    expect(() => validateBoot(features)).not.toThrow();",
    "  });",
    "});",
    "",
  ].join("\n"),
  "src/__tests__/boot.integration.test.ts": [
    'import { afterAll, beforeAll, describe, expect, test } from "bun:test";',
    'import { setupAppTestStack } from "@cosmicdrift/kumiko-dev-server/testing";',
    'import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";',
    'import { APP_FEATURES } from "../run-config";',
    "",
    "let stack: TestStack;",
    "",
    "beforeAll(async () => {",
    "  stack = await setupAppTestStack([...APP_FEATURES]);",
    "});",
    "",
    "afterAll(async () => {",
    "  await stack?.cleanup();",
    "});",
    "",
    'describe("boot", () => {',
    '  test("the mounted features boot and refuse an unknown login", async () => {',
    '    const res = await stack.http.raw("POST", "/api/auth/login", {',
    '      email: "nobody@example.com",',
    '      password: "not-a-real-password",',
    "    });",
    "    expect(res.status).toBeGreaterThanOrEqual(400);",
    "  });",
    "});",
    "",
  ].join("\n"),
};
