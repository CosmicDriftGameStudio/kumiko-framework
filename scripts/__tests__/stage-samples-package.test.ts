import { describe, expect, test } from "bun:test";
import { isShippedSamplePath } from "../stage-samples-package";

describe("isShippedSamplePath", () => {
  test("accepts feature sources and package manifests", () => {
    expect(isShippedSamplePath("packages/bundled-features/src/audit-log/feature.ts")).toBe(true);
    expect(isShippedSamplePath("packages/bundled-features/package.json")).toBe(true);
    expect(isShippedSamplePath("samples/recipes/basic-entity/package.json")).toBe(true);
  });

  test("rejects env files and dot directories", () => {
    expect(isShippedSamplePath("samples/apps/demo/.env.local")).toBe(false);
    expect(isShippedSamplePath("samples/recipes/state-machine/.kumiko/types.ts")).toBe(false);
  });

  test("rejects tests, build output and dependency trees", () => {
    expect(isShippedSamplePath("packages/bundled-features/src/x/__tests__/feature.ts")).toBe(false);
    expect(isShippedSamplePath("samples/apps/demo/src/a.test.ts")).toBe(false);
    expect(isShippedSamplePath("samples/apps/demo/e2e/flow.ts")).toBe(false);
    expect(isShippedSamplePath("samples/apps/demo/node_modules/x/index.ts")).toBe(false);
  });

  test("rejects traversal, absolute paths and non-source extensions", () => {
    expect(isShippedSamplePath("../outside/feature.ts")).toBe(false);
    expect(isShippedSamplePath("samples/../../x.ts")).toBe(false);
    expect(isShippedSamplePath("/etc/passwd.json")).toBe(false);
    expect(isShippedSamplePath("samples/apps/demo/logo.png")).toBe(false);
  });
});
