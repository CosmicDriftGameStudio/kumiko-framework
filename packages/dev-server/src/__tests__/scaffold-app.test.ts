// scaffoldApp unit-tests (DX-1.0 + #352 deploy/schema scaffold).

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ScaffoldTestSetup, scaffoldApp } from "../scaffold-app";

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

const STUB_TEST_SETUP: ScaffoldTestSetup = {
  files: {
    "bunfig.toml": "# stub unit bunfig\n",
    "e2e/smoke.spec.ts": "// stub spec\n",
    "src/__tests__/stub.test.ts": "// stub test\n",
  },
  scripts: { test: "stub-unit", "test:integration": "stub-integration", e2e: "stub-e2e" },
  devDependencies: { "@cosmicdrift/kumiko-testing": "stub-version", "@playwright/test": "^1.0.0" },
  rulesMarkdown: "## Testing\n\n- stub rule\n",
};

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

  test("without testSetup the scaffold keeps the legacy bunfig pair and test script", async () => {
    const dest = join(tmp, "my-shop");
    const result = await scaffoldApp({ name: "my-shop", destination: dest });

    const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts["test"]).toBe("bun --config=bunfig.ci.toml test --dots");
    expect(Object.keys(pkg.scripts)).not.toContain("e2e");
    expect(Object.keys(pkg.devDependencies)).not.toContain("@cosmicdrift/kumiko-testing");
    expect(result.files).toContain("bunfig.ci.toml");
    expect(existsSync(join(dest, "e2e"))).toBe(false);
    expect(readFileSync(join(dest, "README.md"), "utf-8")).not.toContain("## Testing");
  });

  test("scaffolded bunfig.toml and bunfig.ci.toml have no [test].concurrency key", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    for (const file of ["bunfig.toml", "bunfig.ci.toml"]) {
      const parsed = Bun.TOML.parse(readFileSync(join(dest, file), "utf-8")) as {
        test: Record<string, unknown>;
      };
      expect(parsed.test["concurrency"]).toBeUndefined();
    }
  });

  test("testSetup: factory gets name + version, files land (nested dirs) and are reported", async () => {
    const dest = join(tmp, "my-shop");
    let received: { appName: string; frameworkVersion: string } | undefined;
    const result = await scaffoldApp({
      name: "my-shop",
      destination: dest,
      frameworkVersion: "^0.13.0",
      testSetup: (input) => {
        received = input;
        return STUB_TEST_SETUP;
      },
    });

    expect(received).toEqual({ appName: "my-shop", frameworkVersion: "^0.13.0" });
    for (const rel of Object.keys(STUB_TEST_SETUP.files)) {
      expect(result.files).toContain(rel);
      expect(readFileSync(join(dest, rel), "utf-8")).toBe(STUB_TEST_SETUP.files[rel] as string);
    }
    expect(existsSync(join(dest, "bunfig.ci.toml"))).toBe(false);
    expect(result.files.filter((f) => f === "bunfig.toml")).toHaveLength(1);
  });

  test("testSetup: scripts replace test in place, devDependencies merge sorted, rules land in README", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest, testSetup: () => STUB_TEST_SETUP });

    const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts["test"]).toBe("stub-unit");
    expect(Object.keys(pkg.scripts)).toEqual([
      "dev",
      "build",
      "start",
      "boot",
      "typecheck",
      "lint",
      "test",
      "test:integration",
      "e2e",
      "schema:apply",
      "schema:generate",
    ]);
    expect(pkg.devDependencies["@cosmicdrift/kumiko-testing"]).toBe("stub-version");
    const names = Object.keys(pkg.devDependencies);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("@biomejs/biome");

    const readme = readFileSync(join(dest, "README.md"), "utf-8");
    expect(readme).toContain("## Architecture");
    expect(readme.endsWith(STUB_TEST_SETUP.rulesMarkdown)).toBe(true);
  });

  test("tsconfig and biome cover the e2e sources", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest, testSetup: () => STUB_TEST_SETUP });

    const tsconfig = JSON.parse(readFileSync(join(dest, "tsconfig.json"), "utf-8")) as {
      include: string[];
    };
    expect(tsconfig.include).toEqual(expect.arrayContaining(["e2e", "playwright.config.ts"]));
    const biome = JSON.parse(readFileSync(join(dest, "biome.json"), "utf-8")) as {
      files: { includes: string[] };
    };
    expect(biome.files.includes).toEqual(
      expect.arrayContaining(["e2e/**", "playwright.config.ts"]),
    );
  });

  test("src/seed.ts bare return has a skip comment directly above it (kumiko-guard-silent-skip)", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const lines = readFileSync(join(dest, "src/seed.ts"), "utf-8").split("\n");
    const returnLineIndex = lines.findIndex((l) => /^\s*if\s*\(.*\)\s*return;\s*$/.test(l));
    expect(returnLineIndex).toBeGreaterThan(-1);

    const precedingLine = lines[returnLineIndex - 1];
    expect(precedingLine).toMatch(/^\s*\/\/\s*skip:/i);
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

  // kumiko-framework#2330: unset (not pre-filled) so the default stays on
  // resolveKmsWiring's plaintext fallback — a half-filled trio would throw
  // the all-or-none error instead of booting.
  test(".env.example documents the PLATFORM_KEK / SUBJECT_KEYS_DATABASE_URL / KUMIKO_BLIND_INDEX_KEY trio, unset by default", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const env = readFileSync(join(dest, ".env.example"), "utf-8");
    expect(env).toContain("PLATFORM_KEK=\n");
    expect(env).toContain("SUBJECT_KEYS_DATABASE_URL=\n");
    expect(env).toContain("KUMIKO_BLIND_INDEX_KEY=\n");
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

  test("README documents the plaintext-PII default until PLATFORM_KEK/SUBJECT_KEYS_DATABASE_URL/KUMIKO_BLIND_INDEX_KEY are set", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const readme = readFileSync(join(dest, "README.md"), "utf-8");
    expect(readme).toContain("PLATFORM_KEK");
    expect(readme).toContain("plaintext");
  });

  test("callExpression/export-callability mismatch throws instead of silently mis-instantiating", async () => {
    const dest = join(tmp, "my-shop");
    await expect(
      scaffoldApp({
        name: "my-shop",
        destination: dest,
        features: [
          {
            name: "delivery",
            importPath: "@cosmicdrift/kumiko-bundled-features/delivery",
            exportName: "createDeliveryFeature",
            // createDeliveryFeature is a factory function, but this claims it's
            // a plain object export (no trailing "()") — must not silently push
            // the function itself as a FeatureDefinition.
            callExpression: "createDeliveryFeature",
          },
        ],
      }),
    ).rejects.toThrow(/is.*callable but callExpression/);
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

  // kumiko-framework#2330: the --yes recommended set mounts PII-annotated
  // entities (user, tenant-invitation, fileRef via user-data-rights), so
  // runProdApp's PII boot gate throws BOOT ABORTED unless kms/allowPlaintextPii
  // is wired. resolveKmsWiring supplies a real KMS when the env trio is set,
  // otherwise an explicit, logged plaintext fallback — never a silent one.
  test("bin/main.ts wires resolveKmsWiring into runProdApp so the PII boot gate doesn't abort", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const main = readFileSync(join(dest, "bin/main.ts"), "utf-8");
    expect(main).toContain('from "@cosmicdrift/kumiko-framework/crypto"');
    expect(main).toContain("requireKmsWiring(process.env");
    expect(main).toContain("resolveKmsWiring(process.env");
    expect(main).toContain('process.env["NODE_ENV"] === "production"');
    expect(main).not.toContain('if ("allowPlaintextPii" in kmsWiring)');
    expect(main).toContain("...kmsWiring,");
  });

  test("src/run-config.ts mounts secrets + auth-foundation + sessions + tasks + HAS_AUTH", async () => {
    const dest = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: dest });

    const runConfig = readFileSync(join(dest, "src/run-config.ts"), "utf-8");
    expect(runConfig).toContain("createSecretsFeature()");
    expect(runConfig).toContain("authFoundationFeature");
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

// File-content assertions on run-config.ts can't catch a missing sessionStore
// provider — only actually booting the generated bin/main.ts can.
describe("generated default app actually boots (kumiko-framework#3120)", () => {
  const FIXTURE_ROOT = join(import.meta.dir, ".tmp-fixtures");
  const createdDirs: string[] = [];

  afterAll(() => {
    for (const d of createdDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore — best-effort
      }
    }
  });

  test("KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts exits 0 against the default scaffold", async () => {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    const cwd = mkdtempSync(join(FIXTURE_ROOT, "boot-"));
    createdDirs.push(cwd);
    const dest = join(cwd, "boot-fixture");

    await scaffoldApp({ name: "boot-fixture", destination: dest });

    const proc = Bun.spawn({
      cmd: ["bun", "bin/main.ts"],
      cwd: dest,
      env: {
        ...process.env,
        KUMIKO_DRY_RUN_ENV: "boot",
        JWT_SECRET: "a".repeat(32),
        KUMIKO_SECRETS_MASTER_KEY_V1: Buffer.alloc(32, 7).toString("base64"),
        DATABASE_URL: "postgres://dummy:dummy@127.0.0.1:1/dummy",
        REDIS_URL: "redis://127.0.0.1:1",
        PLATFORM_KEK: "",
        SUBJECT_KEYS_DATABASE_URL: "",
        KUMIKO_BLIND_INDEX_KEY: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(code, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);
    expect(`${stdout}${stderr}`).not.toContain("BOOT ABORTED");
    expect(stdout).toContain("boot validation OK");
  });
});
