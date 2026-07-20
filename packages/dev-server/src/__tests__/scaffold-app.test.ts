// scaffoldApp unit-tests (DX-1.0 + #352 deploy/schema scaffold).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldApp } from "../scaffold-app";

const SCAFFOLD_FILES = [
  "package.json",
  "tsconfig.json",
  "biome.json",
  "bunfig.toml",
  "bunfig.ci.toml",
  "src/run-config.ts",
  "src/features/tasks/feature.ts",
  "src/features/tasks/index.ts",
  "src/seed.ts",
  "kumiko/schema.ts",
  "bin/main.ts",
  "bin/dev.ts",
  "bin/kumiko.ts",
  "src/client.tsx",
  "src/styles.css",
  ".env.example",
  "docker-compose.yml",
  "kumiko/migrations/0001_init.sql",
  "kumiko/migrations/.snapshot.json",
  "deploy/Dockerfile",
  "deploy/Dockerfile.dockerignore",
  "deploy/migrate-step.sh",
  "README.md",
] as const;

describe("scaffoldApp", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "scaffold-app-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("scaffolds the expected files into <cwd>/<name>", async () => {
    const dest = join(tmp, "my-shop");
    const result = await scaffoldApp({ name: "my-shop", destination: dest });

    expect(result.appName).toBe("my-shop");
    expect(result.destination).toBe(dest);
    for (const f of SCAFFOLD_FILES) {
      expect(result.files).toContain(f);
      expect(existsSync(join(dest, f))).toBe(true);
    }
  });

  test("package.json has @cosmicdrift/* deps with version pin", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest, frameworkVersion: "^0.13.0" });

    const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf-8")) as {
      name: string;
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe("my-shop");
    expect(pkg.dependencies["@cosmicdrift/kumiko-bundled-features"]).toBe("^0.13.0");
    expect(pkg.dependencies["@cosmicdrift/kumiko-dev-server"]).toBe("^0.13.0");
    expect(pkg.dependencies["@cosmicdrift/kumiko-framework"]).toBe("^0.13.0");
    expect(pkg.dependencies["@cosmicdrift/kumiko-renderer-web"]).toBe("^0.13.0");
    expect(pkg.scripts["boot"]).toContain("KUMIKO_DRY_RUN_ENV=boot");
    expect(pkg.scripts["dev"]).toBe("bun --watch bin/dev.ts");
    expect(pkg.scripts["build"]).toBe("bun kumiko-build");
    expect(pkg.scripts["start"]).toBe("bun run bin/main.ts");
    expect(pkg.scripts["lint"]).toBe("biome check .");
  });

  test("init migration includes auth-mode tables (read_users)", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const sql = readFileSync(join(dest, "kumiko/migrations/0001_init.sql"), "utf-8");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "read_users"');
  });

  test("kumiko/schema.ts + bin/kumiko.ts wire HAS_AUTH single-source", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const schema = readFileSync(join(dest, "kumiko/schema.ts"), "utf-8");
    expect(schema).toContain("APP_FEATURES, HAS_AUTH");
    expect(schema).toContain("collectTableMetas");

    const kumikoBin = readFileSync(join(dest, "bin/kumiko.ts"), "utf-8");
    expect(kumikoBin).toContain("runSchemaCli");
    expect(kumikoBin).toContain("runConsumerCli");
    expect(kumikoBin).toContain("includeBundled: HAS_AUTH");
  });

  test("bin/dev.ts contains runDevApp + welcomeBanner + admin login + clientEntry", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const dev = readFileSync(join(dest, "bin/dev.ts"), "utf-8");
    expect(dev).toContain("runDevApp");
    expect(dev).toContain("welcomeBanner: true");
    expect(dev).toContain("admin@my-shop.local");
    expect(dev).toContain(`password: "changeme"`);
    expect(dev).toContain(`clientEntry: "./src/client.tsx"`);
  });

  test("src/client.tsx bundles createKumikoApp + emailPasswordClient + DefaultAppShell", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const client = readFileSync(join(dest, "src/client.tsx"), "utf-8");
    expect(client).toContain("createKumikoApp");
    expect(client).toContain("emailPasswordClient");
    expect(client).toContain("DefaultAppShell");
    expect(client).toContain("shell: AppShell");
    expect(client).toContain("function AppShell(");
    expect(client).toContain("brand={<span");
    expect(client).toContain(">my-shop</span>");
    expect(client).toContain('from "@cosmicdrift/kumiko-renderer-web"');
    expect(client).toContain('from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web"');
    expect(client).toContain("tasksClient");
  });

  test(".env.example carries KUMIKO_DEV_DB_NAME default so reboots are persistent", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const env = readFileSync(join(dest, ".env.example"), "utf-8");
    expect(env).toContain("KUMIKO_DEV_DB_NAME=my_shop_dev");
  });

  test(".env.example lists both TEST_DATABASE_URL (bun dev) + DATABASE_URL (prod)", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const env = readFileSync(join(dest, ".env.example"), "utf-8");
    expect(env).toContain("TEST_DATABASE_URL=");
    expect(env).toContain("DATABASE_URL=");
  });

  test("docker-compose.yml ports + credentials match the .env.example *_URL defaults", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const compose = readFileSync(join(dest, "docker-compose.yml"), "utf-8");
    const env = readFileSync(join(dest, ".env.example"), "utf-8");
    expect(env).toContain("127.0.0.1:5432");
    expect(env).toContain("127.0.0.1:6379");
    expect(compose).toContain('"127.0.0.1:5432:5432"');
    expect(compose).toContain('"127.0.0.1:6379:6379"');
    expect(compose).not.toContain('"5432:5432"');
    expect(compose).not.toContain('"6379:6379"');
    expect(compose).toContain("POSTGRES_PASSWORD: postgres");
    expect(compose).toContain("image: postgres:");
    expect(compose).toContain("image: redis:");
  });

  test("README lists the mounted features dynamically", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({
      name: "my-shop",
      destination: dest,
      features: [
        {
          name: "tenant",
          importPath: "@cosmicdrift/kumiko-bundled-features/tenant",
          exportName: "createTenantFeature",
          callExpression: "createTenantFeature()",
        },
        {
          name: "delivery",
          importPath: "@cosmicdrift/kumiko-bundled-features/delivery",
          exportName: "createDeliveryFeature",
          callExpression: "createDeliveryFeature()",
        },
      ],
    });

    const readme = readFileSync(join(dest, "README.md"), "utf-8");
    expect(readme).toContain("## Mounted features");
    expect(readme).toContain("- `tenant`");
    expect(readme).toContain("- `delivery`");
  });

  test("bin/main.ts contains runProdApp + auth.admin stub + staticDir", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const main = readFileSync(join(dest, "bin/main.ts"), "utf-8");
    expect(main).toContain("runProdApp");
    expect(main).toContain('staticDir: "./dist"');
    expect(main).toContain("auth: {");
    expect(main).toContain("admin@my-shop.local");
    expect(main).toContain('tenantKey: "my-shop"');
    expect(main).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/);
  });

  test("bin/main.ts composes the auth-mode feature set into envSchema (JWT_SECRET boot-gate)", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const main = readFileSync(join(dest, "bin/main.ts"), "utf-8");
    expect(main).toContain("composeFeatures(APP_FEATURES, { includeBundled: HAS_AUTH })");
    expect(main).toContain(
      "composeEnvSchema({ core: frameworkCoreEnvSchema, features: bootFeatures })",
    );
  });

  test("src/run-config.ts mounts secrets + sessions + tasks + HAS_AUTH", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const runConfig = readFileSync(join(dest, "src/run-config.ts"), "utf-8");
    expect(runConfig).toContain("createSecretsFeature()");
    expect(runConfig).toContain("createSessionsFeature()");
    expect(runConfig).toContain("tasksFeature");
    expect(runConfig).toContain('from "./features/tasks"');
    expect(runConfig).toContain("export const APP_FEATURES");
    expect(runConfig).toContain("export const HAS_AUTH");
  });

  test("rejects non-kebab-case names", async () => {
    await expect(scaffoldApp({ name: "MyShop", destination: tmp })).rejects.toThrow(/kebab-case/);
    await expect(scaffoldApp({ name: "my_shop", destination: tmp })).rejects.toThrow(/kebab-case/);
    await expect(scaffoldApp({ name: "0shop", destination: tmp })).rejects.toThrow(/kebab-case/);
  });

  test("rejects trailing- and double-hyphen names (invalid package segment)", async () => {
    await expect(scaffoldApp({ name: "my-shop-", destination: tmp })).rejects.toThrow(/kebab-case/);
    await expect(scaffoldApp({ name: "my--shop", destination: tmp })).rejects.toThrow(/kebab-case/);
  });

  test("resolves a relative destination against the supplied cwd, not process.cwd()", async () => {
    const result = await scaffoldApp({ name: "shop", destination: "apps/shop", cwd: tmp });
    expect(result.destination).toBe(join(tmp, "apps/shop"));
    expect(existsSync(join(tmp, "apps/shop", "package.json"))).toBe(true);
  });

  test("resolves the name-default destination against the supplied cwd", async () => {
    const result = await scaffoldApp({ name: "shop", cwd: tmp });
    expect(result.destination).toBe(join(tmp, "shop"));
    expect(existsSync(join(tmp, "shop", "package.json"))).toBe(true);
  });

  test("refuses to overwrite existing destination", async () => {
    const dest = join(tmp, "existing");
    await scaffoldApp({ name: "existing", destination: dest });
    await expect(scaffoldApp({ name: "existing", destination: dest })).rejects.toThrow(
      /already exists/,
    );
  });

  test("features-param: custom selection lands in run-config.ts imports + APP_FEATURES", async () => {
    const dest = join(tmp, "custom-features");
    await scaffoldApp({
      name: "custom-features",
      destination: dest,
      features: [
        {
          name: "billing-foundation",
          importPath: "@cosmicdrift/kumiko-bundled-features/billing-foundation",
          exportName: "billingFoundationFeature",
          callExpression: "billingFoundationFeature",
        },
        {
          name: "delivery",
          importPath: "@cosmicdrift/kumiko-bundled-features/delivery",
          exportName: "createDeliveryFeature",
          callExpression: "createDeliveryFeature()",
        },
      ],
    });
    const cfg = readFileSync(join(dest, "src/run-config.ts"), "utf-8");
    expect(cfg).toContain('from "@cosmicdrift/kumiko-bundled-features/billing-foundation"');
    expect(cfg).toContain('from "@cosmicdrift/kumiko-bundled-features/delivery"');
    expect(cfg).toContain("billingFoundationFeature");
    expect(cfg).toContain("createDeliveryFeature()");
    expect(cfg).not.toContain("createSecretsFeature");
    expect(cfg).not.toContain("createSessionsFeature");
  });

  test("features-param: empty array falls back to foundation (backwards-compat)", async () => {
    const dest = join(tmp, "empty-features");
    await scaffoldApp({ name: "empty-features", destination: dest, features: [] });
    const cfg = readFileSync(join(dest, "src/run-config.ts"), "utf-8");
    expect(cfg).toContain("createSecretsFeature()");
    expect(cfg).toContain("createSessionsFeature()");
  });

  test("features-param: composeFeatures auto-mounted names are filtered out", async () => {
    const dest = join(tmp, "filtered");
    await scaffoldApp({
      name: "filtered",
      destination: dest,
      features: [
        {
          name: "config",
          importPath: "@cosmicdrift/kumiko-bundled-features/config",
          exportName: "createConfigFeature",
          callExpression: "createConfigFeature()",
        },
        {
          name: "user",
          importPath: "@cosmicdrift/kumiko-bundled-features/user",
          exportName: "createUserFeature",
          callExpression: "createUserFeature()",
        },
        {
          name: "tenant",
          importPath: "@cosmicdrift/kumiko-bundled-features/tenant",
          exportName: "createTenantFeature",
          callExpression: "createTenantFeature()",
        },
        {
          name: "auth-email-password",
          importPath: "@cosmicdrift/kumiko-bundled-features/auth-email-password",
          exportName: "createAuthEmailPasswordFeature",
          callExpression: "createAuthEmailPasswordFeature()",
        },
        {
          name: "delivery",
          importPath: "@cosmicdrift/kumiko-bundled-features/delivery",
          exportName: "createDeliveryFeature",
          callExpression: "createDeliveryFeature()",
        },
      ],
    });
    const cfg = readFileSync(join(dest, "src/run-config.ts"), "utf-8");
    expect(cfg).not.toContain("createConfigFeature");
    expect(cfg).not.toContain("createUserFeature");
    expect(cfg).not.toContain("createTenantFeature");
    expect(cfg).not.toContain("createAuthEmailPasswordFeature");
    expect(cfg).toContain("createDeliveryFeature()");
  });

  test("features-param: ONLY auto-mounted names → empty effective set, no foundation fallback", async () => {
    const dest = join(tmp, "only-auto-mounted");
    await scaffoldApp({
      name: "only-auto-mounted",
      destination: dest,
      features: [
        {
          name: "config",
          importPath: "@cosmicdrift/kumiko-bundled-features/config",
          exportName: "createConfigFeature",
          callExpression: "createConfigFeature()",
        },
        {
          name: "user",
          importPath: "@cosmicdrift/kumiko-bundled-features/user",
          exportName: "createUserFeature",
          callExpression: "createUserFeature()",
        },
        {
          name: "tenant",
          importPath: "@cosmicdrift/kumiko-bundled-features/tenant",
          exportName: "createTenantFeature",
          callExpression: "createTenantFeature()",
        },
        {
          name: "auth-email-password",
          importPath: "@cosmicdrift/kumiko-bundled-features/auth-email-password",
          exportName: "createAuthEmailPasswordFeature",
          callExpression: "createAuthEmailPasswordFeature()",
        },
      ],
    });
    const cfg = readFileSync(join(dest, "src/run-config.ts"), "utf-8");
    expect(cfg).not.toContain("createSecretsFeature");
    expect(cfg).not.toContain("createSessionsFeature");
    expect(cfg).toContain("tasksFeature");
  });

  test("deterministic tenantId for same name (reproducible boots)", async () => {
    const a = join(tmp, "a");
    const b = join(tmp, "b");
    await scaffoldApp({ name: "stable", destination: a });
    await scaffoldApp({ name: "stable", destination: b });
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
