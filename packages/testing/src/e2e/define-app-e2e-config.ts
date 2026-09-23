import { randomUUID } from "node:crypto";
import { cpus } from "node:os";
import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
  type PlaywrightTestOptions,
  type PlaywrightWorkerOptions,
  type Project,
} from "@playwright/test";
import {
  E2E_WORKERS_ENV,
  PLAYWRIGHT_DEMO_ENV,
  REAL_PROVIDERS_ENV,
  SEED_ENABLE_ENV,
  SEED_TOKEN_ENV,
} from "./constants";
import { screenshotSpecsIgnore } from "./screenshot-dir";
import { E2E_TIMEOUT_MS } from "./timeouts";

const TEMPLATE_OWNED_PROJECT_KEYS = [
  "fullyParallel",
  "retries",
  "timeout",
  "workers",
  "expect",
] as const;
const TEMPLATE_OWNED_USE_KEYS = ["actionTimeout", "navigationTimeout"] as const;
const REAL_SPEC_GLOB = "**/*.real.spec.ts";
const RESERVED_ENV_KEYS = ["PORT", SEED_ENABLE_ENV, SEED_TOKEN_ENV] as const;

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
  cpuCount: number = cpus().length,
): number {
  const override = env[E2E_WORKERS_ENV];
  if (override === undefined || override === "") {
    return Math.max(2, Math.min(4, Math.floor(cpuCount / 2)));
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
  const realRun = process.env[REAL_PROVIDERS_ENV] === "1";

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
    timeout: E2E_TIMEOUT_MS.test,
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
        ...PLAYWRIGHT_DEMO_ENV,
        ...env,
        PORT: String(port),
        [SEED_ENABLE_ENV]: "1",
        [SEED_TOKEN_ENV]: seedTokenForRun(),
      },
      reuseExistingServer: false,
      timeout: E2E_TIMEOUT_MS.webServer,
      stdout: "pipe",
      stderr: "pipe",
    },
  });
}
