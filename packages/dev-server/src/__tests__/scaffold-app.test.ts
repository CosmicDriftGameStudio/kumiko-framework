// scaffoldApp unit-tests (DX-1.0).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  test("bin/main.ts composes the auth-mode feature set into envSchema (JWT_SECRET boot-gate)", () => {
    const dest = join(tmp, "my-shop");
    scaffoldApp({ name: "my-shop", destination: dest });

    const main = readFileSync(join(dest, "bin/main.ts"), "utf-8");
    // envSchema must cover the same features runProdApp auto-mixes via
    // auth-mode — otherwise auth-email-password's JWT_SECRET (min-32) is
    // absent from the boot-gate and a too-short secret slips through.
    expect(main).toContain("composeFeatures(APP_FEATURES, { includeBundled: true })");
    expect(main).toContain(
      "composeEnvSchema({ core: frameworkCoreEnvSchema, features: bootFeatures })",
    );
    expect(main).toContain("composeFeatures");
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

  test("rejects trailing- and double-hyphen names (invalid package segment)", () => {
    expect(() => scaffoldApp({ name: "my-shop-", destination: tmp })).toThrow(/kebab-case/);
    expect(() => scaffoldApp({ name: "my--shop", destination: tmp })).toThrow(/kebab-case/);
  });

  test("resolves a relative destination against the supplied cwd, not process.cwd()", () => {
    // The CLI passes ctx.cwd; the scaffold must land under it so the
    // displayed path matches the actual write location.
    const result = scaffoldApp({ name: "shop", destination: "apps/shop", cwd: tmp });
    expect(result.destination).toBe(join(tmp, "apps/shop"));
    expect(existsSync(join(tmp, "apps/shop", "package.json"))).toBe(true);
  });

  test("resolves the name-default destination against the supplied cwd", () => {
    const result = scaffoldApp({ name: "shop", cwd: tmp });
    expect(result.destination).toBe(join(tmp, "shop"));
    expect(existsSync(join(tmp, "shop", "package.json"))).toBe(true);
  });

  test("refuses to overwrite existing destination", () => {
    const dest = join(tmp, "existing");
    scaffoldApp({ name: "existing", destination: dest });
    expect(() => scaffoldApp({ name: "existing", destination: dest })).toThrow(/already exists/);
  });

  test("features-param: custom selection lands in run-config.ts imports + APP_FEATURES", () => {
    const dest = join(tmp, "custom-features");
    scaffoldApp({
      name: "custom-features",
      destination: dest,
      features: [
        {
          name: "tenant",
          importPath: "@cosmicdrift/kumiko-bundled-features/tenant",
          exportName: "createTenantFeature",
          callExpression: "createTenantFeature()",
        },
        {
          name: "billing-foundation",
          importPath: "@cosmicdrift/kumiko-bundled-features/billing-foundation",
          exportName: "billingFoundationFeature",
          callExpression: "billingFoundationFeature",
        },
      ],
    });
    const cfg = readFileSync(join(dest, "src/run-config.ts"), "utf-8");
    expect(cfg).toContain('from "@cosmicdrift/kumiko-bundled-features/tenant"');
    expect(cfg).toContain('from "@cosmicdrift/kumiko-bundled-features/billing-foundation"');
    expect(cfg).toContain("createTenantFeature()");
    expect(cfg).toContain("billingFoundationFeature");
    expect(cfg).not.toContain("createSecretsFeature");
    expect(cfg).not.toContain("createSessionsFeature");
  });

  test("features-param: empty array falls back to foundation (backwards-compat)", () => {
    const dest = join(tmp, "empty-features");
    scaffoldApp({ name: "empty-features", destination: dest, features: [] });
    const cfg = readFileSync(join(dest, "src/run-config.ts"), "utf-8");
    expect(cfg).toContain("createSecretsFeature()");
    expect(cfg).toContain("createSessionsFeature()");
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
