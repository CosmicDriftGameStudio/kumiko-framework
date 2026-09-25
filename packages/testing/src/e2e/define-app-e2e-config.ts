import { randomUUID } from "node:crypto";
import { availableParallelism } from "node:os";
import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
  type PlaywrightTestOptions,
  type PlaywrightWorkerOptions,
  type Project,
} from "@playwright/test";
import { SERVICE_ENV_DEFAULTS } from "../preload/service-env-defaults-values";
import {
  E2E_WORKERS_ENV,
  isRealProviderRun,
  PLAYWRIGHT_DEMO_ENV,
  PROD_BUNDLES_ENV,
  SEED_ENABLE_ENV,
  SEED_TOKEN_ENV,
  STYLESHEET_WATCH_ENV,
} from "./constants";
import { screenshotSpecsIgnore } from "./screenshot-dir";
import { E2E_TIMEOUT_MS } from "./timeouts";

// A `??` merge per key, not a raw process.env spread — CI or the shell
// environment wins over the local-dev default without leaking unrelated
// host env vars into the webServer process.
function infraEnvDefaults(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(SERVICE_ENV_DEFAULTS).map(([key, value]) => [key, process.env[key] ?? value]),
  );
}

const TEMPLATE_OWNED_PROJECT_KEYS = [
  "fullyParallel",
  "retries",
  "timeout",
  "workers",
  "expect",
] as const;
const TEMPLATE_OWNED_USE_KEYS = ["actionTimeout", "navigationTimeout"] as const;
const REAL_SPEC_GLOB = "**/*.real.spec.ts";
const RESERVED_ENV_KEYS = [
  "PORT",
  SEED_ENABLE_ENV,
  SEED_TOKEN_ENV,
  STYLESHEET_WATCH_ENV,
  PROD_BUNDLES_ENV,
] as const;

type ProjectUse = Partial<PlaywrightTestOptions & PlaywrightWorkerOptions>;

export type E2eProject = Omit<Project, (typeof TEMPLATE_OWNED_PROJECT_KEYS)[number] | "use"> & {
  readonly use?: Omit<ProjectUse, (typeof TEMPLATE_OWNED_USE_KEYS)[number]>;
};

export type AppE2eConfigInput = {
  readonly port: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly locale?: string;
  readonly projects?: readonly E2eProject[];
  readonly serverEntry?: string;
  readonly testDir?: string;
  readonly testMatch?: string | RegExp | readonly (string | RegExp)[];
};

function mutableTestMatch(
  match: NonNullable<AppE2eConfigInput["testMatch"]>,
): string | RegExp | (string | RegExp)[] {
  return typeof match === "string" || match instanceof RegExp ? match : [...match];
}

export function resolveE2eWorkers(
  env: Readonly<Record<string, string | undefined>> = process.env,
  // cpus() reports every host core inside a CPU-limited container (1.5 CPU CI
  // pods got 4 workers); availableParallelism() honours the cgroup quota.
  cpuCount: number = availableParallelism(),
): number {
  const override = env[E2E_WORKERS_ENV];
  if (override === undefined || override === "") {
    // 1.5 CPU CI pod, publicstatus 59 tests: 1/2/4 workers = 2.6/2.6/2.7 min;
    // saturated at 1.
    return Math.max(1, Math.min(4, Math.floor(cpuCount / 2)));
  }
  const workers = Number(override);
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`${E2E_WORKERS_ENV} must be a positive integer, got "${override}"`);
  }
  return workers;
}

function assertTemplateOwnedKeysUnset(project: E2eProject): void {
  const name = project.name ?? "(unnamed)";
  const setKeys: readonly string[] = Object.keys(project);
  const useKeys: readonly string[] = Object.keys(project.use ?? {});
  const offending = [
    ...TEMPLATE_OWNED_PROJECT_KEYS.filter((key) => setKeys.includes(key)),
    ...TEMPLATE_OWNED_USE_KEYS.filter((key) => useKeys.includes(key)).map((key) => `use.${key}`),
  ];
  if (offending.length > 0) {
    throw new Error(
      `defineAppE2eConfig: project "${name}" sets ${offending.join(", ")}; timeouts, retries and workers belong to the template. Diagnose per https://github.com/CosmicDriftGameStudio/kumiko-framework/blob/main/docs/guides/test-failures.md instead of raising them.`,
    );
  }
}

function assertNoReservedEnv(env: Readonly<Record<string, string>>): void {
  const reserved = RESERVED_ENV_KEYS.filter((key) => key in env);
  if (reserved.length > 0) {
    throw new Error(
      `defineAppE2eConfig: env must not set ${reserved.join(", ")}; the template owns them.`,
    );
  }
}

// Workers re-evaluate this config but inherit the runner's env, so ??= keeps one token per run.
function seedTokenForRun(): string {
  process.env[SEED_TOKEN_ENV] ??= randomUUID();
  return process.env[SEED_TOKEN_ENV];
}

export function defineAppE2eConfig(input: AppE2eConfigInput): PlaywrightTestConfig {
  const {
    port,
    env = {},
    locale = "en",
    projects = [],
    serverEntry = "e2e/server.ts",
    testDir = "./e2e",
    testMatch,
  } = input;
  assertNoReservedEnv(env);
  for (const project of projects) assertTemplateOwnedKeysUnset(project);
  const baseURL = `http://localhost:${port}`;
  const realRun = isRealProviderRun();

  return defineConfig({
    testDir,
    ...(realRun
      ? { testMatch: REAL_SPEC_GLOB }
      : testMatch !== undefined && { testMatch: mutableTestMatch(testMatch) }),
    testIgnore: [...screenshotSpecsIgnore(), ...(realRun ? [] : [REAL_SPEC_GLOB])],
    fullyParallel: true,
    forbidOnly: !!process.env["CI"],
    retries: 0,
    workers: resolveE2eWorkers(),
    reporter: [["list"]],
    timeout: realRun ? E2E_TIMEOUT_MS.real : E2E_TIMEOUT_MS.test,
    expect: { timeout: E2E_TIMEOUT_MS.expect },
    use: {
      baseURL,
      locale,
      trace: "retain-on-failure",
      screenshot: "only-on-failure",
      actionTimeout: E2E_TIMEOUT_MS.action,
      navigationTimeout: E2E_TIMEOUT_MS.navigation,
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }, ...projects],
    webServer: {
      command: `bun run ${serverEntry}`,
      url: baseURL,
      env: {
        ...infraEnvDefaults(),
        ...PLAYWRIGHT_DEMO_ENV,
        ...env,
        PORT: String(port),
        [SEED_ENABLE_ENV]: "1",
        [SEED_TOKEN_ENV]: seedTokenForRun(),
        // A Tailwind --watch process subscribes to the whole app cwd
        // recursively (Tailwind v4, no gitignore filter); every Playwright
        // artifact write under test-results/ would then count as a rebuild.
        [STYLESHEET_WATCH_ENV]: "0",
        // E2E runs against prod-shaped bundles: splitting, no sourcemap,
        // NODE_ENV=production — matches what actually ships.
        [PROD_BUNDLES_ENV]: "1",
      },
      reuseExistingServer: false,
      timeout: E2E_TIMEOUT_MS.webServer,
      stdout: "pipe",
      stderr: "pipe",
    },
  });
}
