import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import {
  defineConfig,
  devices,
  type LaunchOptions,
  type PlaywrightTestConfig,
  type PlaywrightTestOptions,
  type PlaywrightWorkerOptions,
  type Project,
} from "@playwright/test";
import { E2E_TIMEOUT_MS } from "../e2e-timeouts";
import { isRealProviderRun } from "../helpers/real-providers.ts";
import { SERVICE_ENV_DEFAULTS } from "../preload/service-env-defaults-values";
import {
  DESKTOP_VIEWPORT,
  E2E_REMOTE_BASE_URL_ENV,
  E2E_STORAGE_STATE_ENV,
  E2E_WORKERS_ENV,
  PLAYWRIGHT_DEMO_ENV,
  PROD_BUNDLES_ENV,
  SCREENSHOT_DEVICE_SCALE_FACTOR,
  SEED_ENABLE_ENV,
  SEED_TOKEN_ENV,
  STYLESHEET_WATCH_ENV,
  TRUSTED_PROXY_HOPS_ENV,
} from "./constants";
import { isScreenshotRun, requireScreenshotDir, screenshotSpecsIgnore } from "./screenshot-dir";

// Apps pick Meilisearch over their in-memory search adapter just because
// MEILI_URL is set, so a default here would point every consumer without a
// Meili service at an unreachable host. Meili stays opt-in: environment or `env`.
const OPT_IN_SERVICE_ENV_KEYS: readonly string[] = [
  "MEILI_URL",
  "MEILI_MASTER_KEY",
] satisfies readonly (keyof typeof SERVICE_ENV_DEFAULTS)[];

// Bun never overrides a variable that is already set, so a default placed in
// webServer.env would beat the same key in the app's `.env`. Keys the app's
// dotenv files define are therefore left out and stay with the server's own loading.
function keysDefinedInAppDotenv(): ReadonlySet<string> {
  // Same files Bun loads: .env, .env.<NODE_ENV>, .env.local. Only the key set matters, not precedence.
  const nodeEnv = process.env["NODE_ENV"] ?? "development";
  const keys = new Set<string>();
  for (const fileName of [".env", `.env.${nodeEnv}`, ".env.local"]) {
    const dotenvPath = join(process.cwd(), fileName);
    if (!existsSync(dotenvPath)) continue;
    for (const key of Object.keys(parseEnv(readFileSync(dotenvPath, "utf-8")))) keys.add(key);
  }
  return keys;
}

// Precedence per key: shell/CI environment, then the app's `.env`, then the local-dev default.
function infraEnvDefaults(): Record<string, string> {
  const definedInAppDotenv = keysDefinedInAppDotenv();
  return Object.fromEntries(
    Object.entries(SERVICE_ENV_DEFAULTS).flatMap(([key, value]) => {
      const fromEnvironment = process.env[key];
      if (OPT_IN_SERVICE_ENV_KEYS.includes(key)) {
        return fromEnvironment === undefined ? [] : [[key, fromEnvironment]];
      }
      if (fromEnvironment === undefined && definedInAppDotenv.has(key)) return [];
      return [[key, fromEnvironment ?? value]];
    }),
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
export const ISOLATED_E2E_PROJECT_NAME = "chromium-isolated";
export const NON_REAL_SPEC_PATTERN = /(?<!\.real)\.spec\.ts$/;
const RESERVED_ENV_KEYS = [
  "PORT",
  SEED_ENABLE_ENV,
  SEED_TOKEN_ENV,
  STYLESHEET_WATCH_ENV,
  PROD_BUNDLES_ENV,
  TRUSTED_PROXY_HOPS_ENV,
] as const;

type ProjectUse = Partial<PlaywrightTestOptions & PlaywrightWorkerOptions>;

export type E2eProject = Omit<Project, (typeof TEMPLATE_OWNED_PROJECT_KEYS)[number] | "use"> & {
  readonly use?: Omit<ProjectUse, (typeof TEMPLATE_OWNED_USE_KEYS)[number]>;
};

type ServerStart =
  | {
      readonly serverEntry?: string;
      readonly preload?: string | readonly string[];
      readonly serverCommand?: never;
    }
  | {
      readonly serverCommand: string;
      readonly serverEntry?: never;
      readonly preload?: never;
    };

export type AppE2eConfigInput = {
  readonly port: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly locale?: string;
  readonly projects?: readonly E2eProject[];
  readonly testDir?: string;
  readonly testMatch?: string | RegExp | readonly (string | RegExp)[];
  readonly isolatedSpecs?: string | RegExp | readonly (string | RegExp)[];
  readonly permissions?: readonly string[];
  readonly launchOptions?: LaunchOptions;
} & ServerStart;

function serverStartCommand(input: {
  readonly serverCommand?: string;
  readonly serverEntry?: string;
  readonly preload?: string | readonly string[];
}): string {
  const { serverCommand, serverEntry = "e2e/server.ts", preload } = input;
  if (serverCommand !== undefined) {
    if (input.serverEntry !== undefined || preload !== undefined) {
      throw new Error(
        "defineAppE2eConfig: serverCommand replaces serverEntry and preload; set only one",
      );
    }
    return serverCommand;
  }
  const preloads = preload === undefined ? [] : typeof preload === "string" ? [preload] : preload;
  const preloadFlags = preloads.map((path) => `--preload ${path} `).join("");
  return `bun run ${preloadFlags}${serverEntry}`;
}

function mutableTestMatch(
  match: NonNullable<AppE2eConfigInput["testMatch"]>,
): string | RegExp | (string | RegExp)[] {
  return typeof match === "string" || match instanceof RegExp ? match : [...match];
}

function patternList(
  patterns: NonNullable<AppE2eConfigInput["testMatch"]> | undefined,
): (string | RegExp)[] {
  if (patterns === undefined) return [];
  return typeof patterns === "string" || patterns instanceof RegExp ? [patterns] : [...patterns];
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

type RemoteTarget = { readonly baseURL: string; readonly storageState: string | undefined };

// A set KUMIKO_E2E_REMOTE_BASE_URL points the run at an already running instance (staging, prod)
// instead of a locally started server. The session comes from a Playwright storageState file the
// operator recorded, so no login is automated against the remote.
function remoteTargetFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): RemoteTarget | undefined {
  const rawBaseUrl = env[E2E_REMOTE_BASE_URL_ENV];
  const storageState = env[E2E_STORAGE_STATE_ENV];
  const hasStorageState = storageState !== undefined && storageState !== "";
  if (rawBaseUrl === undefined || rawBaseUrl === "") {
    if (hasStorageState) {
      throw new Error(
        `defineAppE2eConfig: ${E2E_STORAGE_STATE_ENV} is only used together with ${E2E_REMOTE_BASE_URL_ENV}`,
      );
    }
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new Error(
      `defineAppE2eConfig: ${E2E_REMOTE_BASE_URL_ENV} must be an http(s) URL, got "${rawBaseUrl}"`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `defineAppE2eConfig: ${E2E_REMOTE_BASE_URL_ENV} must be an http(s) URL, got "${rawBaseUrl}"`,
    );
  }
  return { baseURL: rawBaseUrl, storageState: hasStorageState ? storageState : undefined };
}

// A remote target is a real deployment: trace zips hold its session cookie and data, and a
// failure screenshot or video shows them, so nothing is recorded there.
function failureRecording(
  remote: RemoteTarget | undefined,
): Pick<NonNullable<PlaywrightTestConfig["use"]>, "trace" | "screenshot" | "video"> {
  if (remote === undefined) return { trace: "retain-on-failure", screenshot: "only-on-failure" };
  return { trace: "off", screenshot: "off", video: "off" };
}

// Worker processes do not carry --shard in argv, so only the runner trips this.
function isShardedRun(argv: readonly string[] = process.argv): boolean {
  return argv.some((arg) => arg === "--shard" || arg.startsWith("--shard="));
}

type ProjectsInput = {
  readonly chromiumUse: Project["use"];
  readonly appProjects: readonly E2eProject[];
  readonly isolated: readonly (string | RegExp)[];
  readonly baseIgnore: readonly string[];
  readonly realRun: boolean;
};

function assertIsolatedSpecsUsable(appProjects: readonly E2eProject[]): void {
  if (appProjects.some((project) => project.name === undefined)) {
    throw new Error(
      "defineAppE2eConfig: isolatedSpecs needs named projects, because the isolated project waits for them via dependencies",
    );
  }
  if (isShardedRun()) {
    throw new Error(
      "defineAppE2eConfig: isolatedSpecs cannot be combined with --shard; Playwright does not shard dependency projects, so one shard would run every spec.",
    );
  }
}

function buildE2eProjects(input: ProjectsInput): Project[] {
  const { chromiumUse, appProjects, isolated, baseIgnore, realRun } = input;
  const baseProjects: Project[] = [{ name: "chromium", use: chromiumUse }, ...appProjects];
  if (isolated.length === 0) return baseProjects;
  assertIsolatedSpecsUsable(appProjects);
  // A project-level testIgnore replaces the top-level one instead of merging with it.
  const parallelProjects = baseProjects.map((project) => ({
    ...project,
    testIgnore: [...baseIgnore, ...patternList(project.testIgnore), ...isolated],
  }));
  return [
    ...parallelProjects,
    {
      name: ISOLATED_E2E_PROJECT_NAME,
      testMatch: [...isolated],
      testIgnore: [...baseIgnore, ...(realRun ? [NON_REAL_SPEC_PATTERN] : [])],
      dependencies: parallelProjects.flatMap((project) =>
        project.name === undefined ? [] : [project.name],
      ),
      fullyParallel: false,
      workers: 1,
      use: chromiumUse,
    },
  ];
}

export function defineAppE2eConfig(input: AppE2eConfigInput): PlaywrightTestConfig {
  const {
    port,
    env = {},
    locale = "en",
    projects = [],
    testDir = "./e2e",
    testMatch,
    isolatedSpecs,
    permissions,
    launchOptions,
  } = input;
  const serverCommand = serverStartCommand(input);
  assertNoReservedEnv(env);
  for (const project of projects) assertTemplateOwnedKeysUnset(project);
  // A dedicated screenshots config (testDir: "./e2e/screenshots") has its
  // entire testDir excluded by screenshotSpecsIgnore() until SCREENSHOT_DIR
  // is set, which Playwright reports as a generic "No tests found" with no
  // mention of the missing env var.
  if (!isScreenshotRun() && /(?:^|\/)screenshots\/?$/.test(testDir)) {
    requireScreenshotDir();
  }
  const remote = remoteTargetFromEnv(process.env);
  const baseURL = remote?.baseURL ?? `http://localhost:${port}`;
  const realRun = isRealProviderRun();
  const baseIgnore = [...screenshotSpecsIgnore(), ...(realRun ? [] : [REAL_SPEC_GLOB])];
  const isolated = patternList(isolatedSpecs);
  const chromiumUse = {
    ...devices["Desktop Chrome"],
    viewport: DESKTOP_VIEWPORT,
    deviceScaleFactor: isScreenshotRun() ? SCREENSHOT_DEVICE_SCALE_FACTOR : 1,
  };
  const e2eProjects = buildE2eProjects({
    chromiumUse,
    appProjects: projects,
    isolated,
    baseIgnore,
    realRun,
  });

  return defineConfig({
    testDir,
    ...(realRun
      ? { testMatch: REAL_SPEC_GLOB }
      : testMatch !== undefined && { testMatch: mutableTestMatch(testMatch) }),
    testIgnore: baseIgnore,
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
      ...failureRecording(remote),
      actionTimeout: E2E_TIMEOUT_MS.action,
      navigationTimeout: E2E_TIMEOUT_MS.navigation,
      ...(remote?.storageState !== undefined && { storageState: remote.storageState }),
      ...(permissions !== undefined && { permissions: [...permissions] }),
      ...(launchOptions !== undefined && { launchOptions }),
    },
    projects: e2eProjects,
    ...(remote === undefined && {
      webServer: {
        command: serverCommand,
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
          // E2e clients all share ::1, so the default trustedProxyHops (0,
          // socket-only) would collapse every seeded user into one rate-limit
          // bucket. loginViaApi sends a synthetic per-user X-Forwarded-For, so
          // trust exactly one hop to give each user its own bucket. An explicit
          // `trustedProxyHops` / `auth.trustedProxyHops` in the consumer's
          // server entrypoint wins over this env and brings the shared bucket
          // (and 429s) back — such a server must read the value from the env.
          [TRUSTED_PROXY_HOPS_ENV]: "1",
        },
        reuseExistingServer: false,
        timeout: E2E_TIMEOUT_MS.webServer,
        stdout: "pipe",
        stderr: "pipe",
      },
    }),
  });
}
