import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TenantInactivityHandlers } from "@cosmicdrift/kumiko-bundled-features/tenant-inactivity/constants";

describe("tenant-inactivity/constants subpath", () => {
  test("exposes the handler names without importing any module", () => {
    expect(TenantInactivityHandlers.keepAccount).toBe("tenant-inactivity:write:keep-account");
    const source = readFileSync(new URL("../constants.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*(import|export\s+\*?.*from)\b/m);
  });

  test("the package maps the subpath to the constants file in source and dist", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.exports["./tenant-inactivity/constants"]).toBe(
      "./src/tenant-inactivity/constants.ts",
    );
    expect(manifest.publishConfig.exports["./tenant-inactivity/constants"].default).toBe(
      "./dist/tenant-inactivity/constants.js",
    );
  });
});
