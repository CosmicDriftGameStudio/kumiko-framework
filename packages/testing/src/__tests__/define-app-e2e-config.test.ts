import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  PROD_BUNDLES_ENV as DEV_SERVER_PROD_BUNDLES_ENV,
  STYLESHEET_WATCH_ENV as DEV_SERVER_STYLESHEET_WATCH_ENV,
} from "@cosmicdrift/kumiko-dev-server";
import {
  E2E_WORKERS_ENV,
  PLAYWRIGHT_DEMO_ENV,
  PROD_BUNDLES_ENV,
  REAL_PROVIDERS_ENV,
  SEED_ENABLE_ENV,
  SEED_TOKEN_ENV,
  STYLESHEET_WATCH_ENV,
} from "../e2e/constants";
import {
  defineAppE2eConfig,
  type E2eProject,
  resolveE2eWorkers,
} from "../e2e/define-app-e2e-config";
import { E2E_TIMEOUT_MS } from "../e2e/timeouts";

const TOUCHED_ENV = [
  SEED_TOKEN_ENV,
  E2E_WORKERS_ENV,
  REAL_PROVIDERS_ENV,
  "CI",
  "SCREENSHOT_DIR",
  "MEILI_URL",
  "MEILI_MASTER_KEY",
] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED_ENV.map((key) => [key, process.env[key]]));
  for (const key of TOUCHED_ENV) delete process.env[key];
});

afterEach(() => {
  for (const key of TOUCHED_ENV) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("defineAppE2eConfig defaults", () => {
  test("enforces parallelism, retries, budgets and a fresh server", () => {
    const config = defineAppE2eConfig({ port: 4321 });

    expect(config.fullyParallel).toBe(true);
    expect(config.retries).toBe(0);
    expect(config.timeout).toBe(E2E_TIMEOUT_MS.test);
    expect(config.expect?.timeout).toBe(E2E_TIMEOUT_MS.expect);
    expect(config.use?.actionTimeout).toBe(E2E_TIMEOUT_MS.action);
    expect(config.use?.navigationTimeout).toBe(E2E_TIMEOUT_MS.navigation);
    expect(config.use?.baseURL).toBe("http://localhost:4321");
    expect(config.use?.locale).toBe("en");
    expect(config.testDir).toBe("./e2e");
    const server = config.webServer;
    if (Array.isArray(server) || server === undefined) throw new Error("expected one webServer");
    expect(server.reuseExistingServer).toBe(false);
    expect(server.command).toBe("bun run e2e/server.ts");
    expect(server.url).toBe("http://localhost:4321");
    expect(server.timeout).toBe(E2E_TIMEOUT_MS.webServer);
  });

  test("screenshot specs only run when SCREENSHOT_DIR is set", () => {
    expect(defineAppE2eConfig({ port: 4321 }).testIgnore).toContain("**/screenshots.spec.ts");

    process.env["SCREENSHOT_DIR"] = "/tmp/shots";
    expect(defineAppE2eConfig({ port: 4321 }).testIgnore).not.toContain("**/screenshots.spec.ts");
  });

  test("real-provider specs stay out of the default run and are the only ones in a real run", () => {
    const normal = defineAppE2eConfig({ port: 4321, testMatch: "**/flows/*.spec.ts" });
    expect(normal.testIgnore).toContain("**/*.real.spec.ts");
    expect(normal.testMatch).toBe("**/flows/*.spec.ts");

    process.env[REAL_PROVIDERS_ENV] = "1";
    const real = defineAppE2eConfig({ port: 4321, testMatch: "**/flows/*.spec.ts" });
    expect(real.testIgnore).not.toContain("**/*.real.spec.ts");
    expect(real.testMatch).toBe("**/*.real.spec.ts");
  });

  test("an API key alone never selects the real specs", () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-test";
    try {
      expect(defineAppE2eConfig({ port: 4321 }).testIgnore).toContain("**/*.real.spec.ts");
    } finally {
      delete process.env["ANTHROPIC_API_KEY"];
    }
  });

  test("the free parameters are port, env, locale, projects, serverEntry, testDir and testMatch", () => {
    const config = defineAppE2eConfig({
      port: 5000,
      locale: "de",
      serverEntry: "e2e/custom-server.ts",
      env: { APP_FLAG: "on" },
      projects: [{ name: "mobile", use: { viewport: { width: 390, height: 844 } } }],
    });

    expect(config.use?.locale).toBe("de");
    expect(config.projects?.map((project) => project.name)).toEqual(["chromium", "mobile"]);
    const server = config.webServer;
    if (Array.isArray(server) || server === undefined) throw new Error("expected one webServer");
    expect(server.command).toBe("bun run e2e/custom-server.ts");
    expect(server.env?.["APP_FLAG"]).toBe("on");
  });

  test("testDir and testMatch pass through; without them the whole ./e2e tree is collected", () => {
    const narrowed = defineAppE2eConfig({
      port: 1,
      testDir: "./e2e/flows",
      testMatch: ["**/login.spec.ts", /checkout\.spec\.ts$/],
    });
    expect(narrowed.testDir).toBe("./e2e/flows");
    expect(narrowed.testMatch).toEqual(["**/login.spec.ts", /checkout\.spec\.ts$/]);
    expect(defineAppE2eConfig({ port: 1, testMatch: "**/one.spec.ts" }).testMatch).toBe(
      "**/one.spec.ts",
    );

    const defaults = defineAppE2eConfig({ port: 1 });
    expect(defaults.testDir).toBe("./e2e");
    expect("testMatch" in defaults).toBe(false);
  });

  test("server env carries port, seed switch, token and the demo defaults; app env may override defaults", () => {
    const config = defineAppE2eConfig({
      port: 6000,
      env: { JWT_SECRET: "app-secret-of-32-characters-long!" },
    });
    const server = config.webServer;
    if (Array.isArray(server) || server === undefined) throw new Error("expected one webServer");

    expect(server.env?.["PORT"]).toBe("6000");
    expect(server.env?.[SEED_ENABLE_ENV]).toBe("1");
    expect(server.env?.[SEED_TOKEN_ENV]).toBe(process.env[SEED_TOKEN_ENV]);
    expect(server.env?.["KUMIKO_SECRETS_MASTER_KEY_V1"]).toBe(
      PLAYWRIGHT_DEMO_ENV.KUMIKO_SECRETS_MASTER_KEY_V1,
    );
    expect(server.env?.["JWT_SECRET"]).toBe("app-secret-of-32-characters-long!");
    expect(server.env?.[STYLESHEET_WATCH_ENV]).toBe("0");
    expect(server.env?.[PROD_BUNDLES_ENV]).toBe("1");
  });

  test("real runs get the 240s real-provider budget from the template", () => {
    expect(defineAppE2eConfig({ port: 1 }).timeout).toBe(E2E_TIMEOUT_MS.test);
    process.env[REAL_PROVIDERS_ENV] = "1";
    expect(defineAppE2eConfig({ port: 1 }).timeout).toBe(E2E_TIMEOUT_MS.real);
  });

  test("webServer env defaults the infra vars, but an env var already set wins", () => {
    const saved = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];
    try {
      const server = defineAppE2eConfig({ port: 1 }).webServer;
      if (Array.isArray(server) || server === undefined) throw new Error("expected one webServer");
      expect(server.env?.["DATABASE_URL"]).toBe(
        "postgresql://kumiko:kumiko@localhost:15432/kumiko_dev",
      );

      process.env["DATABASE_URL"] = "postgresql://ci:ci@ci-host:5432/ci_db";
      const ciServer = defineAppE2eConfig({ port: 1 }).webServer;
      if (Array.isArray(ciServer) || ciServer === undefined) {
        throw new Error("expected one webServer");
      }
      expect(ciServer.env?.["DATABASE_URL"]).toBe("postgresql://ci:ci@ci-host:5432/ci_db");
    } finally {
      if (saved === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = saved;
    }
  });

  test("webServer env leaves Meilisearch unset unless the environment or the app env asks for it", () => {
    const server = defineAppE2eConfig({ port: 1 }).webServer;
    if (Array.isArray(server) || server === undefined) throw new Error("expected one webServer");
    expect(server.env).not.toHaveProperty("MEILI_URL");
    expect(server.env).not.toHaveProperty("MEILI_MASTER_KEY");

    const appServer = defineAppE2eConfig({
      port: 1,
      env: { MEILI_URL: "http://localhost:17700" },
    }).webServer;
    if (Array.isArray(appServer) || appServer === undefined) {
      throw new Error("expected one webServer");
    }
    expect(appServer.env?.["MEILI_URL"]).toBe("http://localhost:17700");

    process.env["MEILI_URL"] = "http://ci-meili:7700";
    process.env["MEILI_MASTER_KEY"] = "ci-key";
    const ciServer = defineAppE2eConfig({ port: 1 }).webServer;
    if (Array.isArray(ciServer) || ciServer === undefined) {
      throw new Error("expected one webServer");
    }
    expect(ciServer.env?.["MEILI_URL"]).toBe("http://ci-meili:7700");
    expect(ciServer.env?.["MEILI_MASTER_KEY"]).toBe("ci-key");
  });

  test("forbidOnly follows CI", () => {
    expect(defineAppE2eConfig({ port: 1 }).forbidOnly).toBe(false);
    process.env["CI"] = "true";
    expect(defineAppE2eConfig({ port: 1 }).forbidOnly).toBe(true);
  });
});

describe("seed token", () => {
  test("is generated once per run and reused when the env already carries one", () => {
    const first = defineAppE2eConfig({ port: 1 });
    const token = process.env[SEED_TOKEN_ENV];
    expect(token).toMatch(/^[0-9a-f-]{36}$/);

    const second = defineAppE2eConfig({ port: 1 });

    expect(process.env[SEED_TOKEN_ENV]).toBe(token);
    const tokens = [first, second].map((config) =>
      Array.isArray(config.webServer) ? undefined : config.webServer?.env?.[SEED_TOKEN_ENV],
    );
    expect(tokens).toEqual([token, token]);
  });

  test("an inherited token (Playwright worker) is kept, not regenerated", () => {
    process.env[SEED_TOKEN_ENV] = "inherited-from-runner";

    defineAppE2eConfig({ port: 1 });

    expect(process.env[SEED_TOKEN_ENV]).toBe("inherited-from-runner");
  });
});

describe("template-owned settings cannot be overridden", () => {
  const forbiddenProjects = [
    { name: "a", retries: 2 },
    { name: "b", workers: 1 },
    { name: "c", timeout: 120_000 },
    { name: "d", fullyParallel: false },
    { name: "e", expect: { timeout: 60_000 } },
    { name: "f", use: { actionTimeout: 60_000 } },
    { name: "g", use: { navigationTimeout: 60_000 } },
  ];

  test("type level: E2eProject rejects the keys", () => {
    // @ts-expect-error retries is template-owned
    const retries: E2eProject = { name: "a", retries: 2 };
    // @ts-expect-error workers is template-owned
    const workers: E2eProject = { name: "b", workers: 1 };
    // @ts-expect-error timeout is template-owned
    const timeout: E2eProject = { name: "c", timeout: 1 };
    // @ts-expect-error fullyParallel is template-owned
    const parallel: E2eProject = { name: "d", fullyParallel: false };
    // @ts-expect-error actionTimeout is template-owned
    const action: E2eProject = { name: "f", use: { actionTimeout: 1 } };
    expect([retries, workers, timeout, parallel, action]).toHaveLength(5);
  });

  test.each(forbiddenProjects)(
    "runtime level: %o throws even when the type is bypassed",
    (project) => {
      // @cast-boundary engine-bridge — deliberately bypasses the type to prove the runtime guard
      const bypassed = project as unknown as E2eProject;

      expect(() => defineAppE2eConfig({ port: 1, projects: [bypassed] })).toThrow(
        /belong to the template/,
      );
    },
  );

  test.each(["PORT", SEED_ENABLE_ENV, SEED_TOKEN_ENV, STYLESHEET_WATCH_ENV, PROD_BUNDLES_ENV])(
    "env key %s is reserved",
    (key) => {
      expect(() => defineAppE2eConfig({ port: 1, env: { [key]: "x" } })).toThrow(/template owns/);
    },
  );

  test("the reserved KUMIKO_DEV_STYLESHEET_WATCH literal matches kumiko-dev-server's own constant", () => {
    expect(STYLESHEET_WATCH_ENV).toBe(DEV_SERVER_STYLESHEET_WATCH_ENV);
  });

  test("the reserved KUMIKO_DEV_PROD_BUNDLES literal matches kumiko-dev-server's own constant", () => {
    expect(PROD_BUNDLES_ENV).toBe(DEV_SERVER_PROD_BUNDLES_ENV);
  });
});

describe("resolveE2eWorkers", () => {
  test.each([
    [1, 1],
    [2, 1],
    [4, 2],
    [6, 3],
    [8, 4],
    [64, 4],
  ])("%i cpus -> %i workers", (cpus, expected) => {
    expect(resolveE2eWorkers({}, cpus)).toBe(expected);
  });

  test("KUMIKO_E2E_WORKERS overrides the default", () => {
    expect(resolveE2eWorkers({ [E2E_WORKERS_ENV]: "7" }, 4)).toBe(7);
  });

  test.each(["0", "-1", "1.5", "many"])("invalid override %s throws", (value) => {
    expect(() => resolveE2eWorkers({ [E2E_WORKERS_ENV]: value }, 4)).toThrow(E2E_WORKERS_ENV);
  });

  test("an empty override falls back to the default", () => {
    expect(resolveE2eWorkers({ [E2E_WORKERS_ENV]: "" }, 8)).toBe(4);
  });

  test("defineAppE2eConfig applies the override", () => {
    process.env[E2E_WORKERS_ENV] = "3";
    expect(defineAppE2eConfig({ port: 1 }).workers).toBe(3);
  });
});
