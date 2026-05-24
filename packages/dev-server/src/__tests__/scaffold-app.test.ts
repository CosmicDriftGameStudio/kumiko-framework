// scaffoldApp unit-tests (DX-1.0).

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { scaffoldApp } from "../scaffold-app";

describe("scaffoldApp", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "scaffold-app-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("scaffolds 6 files into <cwd>/<name>", () => {
    const dest = join(tmp, "my-shop");
    const result = scaffoldApp({ name: "my-shop", destination: dest });

    expect(result.appName).toBe("my-shop");
    expect(result.destination).toBe(dest);
    expect(result.files).toEqual([
      "package.json",
      "tsconfig.json",
      "src/run-config.ts",
      "bin/main.ts",
      ".env.example",
      "README.md",
    ]);
    for (const f of result.files) {
      expect(existsSync(join(dest, f))).toBe(true);
    }
  });

  test("package.json has @cosmicdrift/* deps with version pin", () => {
    const dest = join(tmp, "my-shop");
    scaffoldApp({ name: "my-shop", destination: dest, frameworkVersion: "^0.13.0" });

    const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf-8")) as {
      name: string;
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe("my-shop");
    expect(pkg.dependencies["@cosmicdrift/kumiko-bundled-features"]).toBe("^0.13.0");
    expect(pkg.dependencies["@cosmicdrift/kumiko-dev-server"]).toBe("^0.13.0");
    expect(pkg.dependencies["@cosmicdrift/kumiko-framework"]).toBe("^0.13.0");
    expect(pkg.scripts["boot"]).toContain("KUMIKO_DRY_RUN_ENV=boot");
  });

  test("bin/main.ts contains runProdApp + auth.admin stub", () => {
    const dest = join(tmp, "my-shop");
    scaffoldApp({ name: "my-shop", destination: dest });

    const main = readFileSync(join(dest, "bin/main.ts"), "utf-8");
    expect(main).toContain("runProdApp");
    expect(main).toContain("auth: {");
    expect(main).toContain("admin@my-shop.local");
    expect(main).toContain('tenantKey: "my-shop"');
    // Tenant-ID is a valid UUID-v4 format (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx).
    expect(main).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/);
  });

  test("src/run-config.ts mounts secrets + sessions as foundation", () => {
    const dest = join(tmp, "my-shop");
    scaffoldApp({ name: "my-shop", destination: dest });

    const runConfig = readFileSync(join(dest, "src/run-config.ts"), "utf-8");
    expect(runConfig).toContain("createSecretsFeature()");
    expect(runConfig).toContain("createSessionsFeature()");
    expect(runConfig).toContain("export const APP_FEATURES");
  });

  test("rejects non-kebab-case names", () => {
    expect(() => scaffoldApp({ name: "MyShop", destination: tmp })).toThrow(/kebab-case/);
    expect(() => scaffoldApp({ name: "my_shop", destination: tmp })).toThrow(/kebab-case/);
    expect(() => scaffoldApp({ name: "0shop", destination: tmp })).toThrow(/kebab-case/);
  });

  test("refuses to overwrite existing destination", () => {
    const dest = join(tmp, "existing");
    scaffoldApp({ name: "existing", destination: dest });
    expect(() => scaffoldApp({ name: "existing", destination: dest })).toThrow(/already exists/);
  });

  test("deterministic tenantId for same name (reproducible boots)", () => {
    const a = join(tmp, "a");
    const b = join(tmp, "b");
    scaffoldApp({ name: "stable", destination: a });
    scaffoldApp({ name: "stable", destination: b });
    const mainA = readFileSync(join(a, "bin/main.ts"), "utf-8");
    const mainB = readFileSync(join(b, "bin/main.ts"), "utf-8");
    const uuidA = mainA.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/,
    )?.[0];
    const uuidB = mainB.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/,
    )?.[0];
    expect(uuidA).toBeDefined();
    expect(uuidA).toBe(uuidB);
  });
});
