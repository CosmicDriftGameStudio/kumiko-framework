// @runtime tooling
import { BUNFIG_FILES, renderBunfigFiles, TEST_TIMEOUT_MS } from "./bunfig";
import { REAL_PROVIDERS_ENV } from "./e2e/constants";

export type ScaffoldTestSetup = {
  readonly files: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly rulesMarkdown: string;
};

export type RenderTestSetupInput = {
  readonly appName: string;
  readonly frameworkVersion: string;
  readonly port?: number;
};

// One above the scaffold's `bun dev` default (4173) so both can run side by side.
export const SCAFFOLD_E2E_PORT = 4174;

export const SCAFFOLD_INTEGRATION_PARALLEL = 4;

const PLAYWRIGHT_VERSION = "^1.62.1";

const TEST_RUNTIME_DIRECTIVE = "// @runtime test";

const TASK_CREATE = "tasks:write:task:create";
const TASK_LIST = "tasks:query:task:list";

const RULES_MARKDOWN = [
  "## Testing",
  "",
  "- Three classes, told apart by file name: `*.test.ts` (unit, no services), `*.integration.test.ts` (real Postgres/Redis stack), `e2e/*.spec.ts` (Playwright against a booted app).",
  "- Run them with `bun run test`, `bun run test:integration` and `bun run e2e`. Integration and e2e need `docker compose up -d` and a `.env` (copy `.env.example`).",
  `- Real-provider tests only run with \`${REAL_PROVIDERS_ENV}=1\`, via \`bun run test:real\` / \`bun run e2e:real\`, locally and never in CI.`,
  "- Tests run in parallel by default. Timeouts, retries and workers live in the scripts, the bunfig files and `playwright.config.ts`; never raise them inside a test. The only exception carries a marker: `// @timeout-exception: #<issue> <reason>`.",
  "- Every flow seeds its own tenant: `seedTenant(stack)` in integration tests, the `seedTenant` fixture in e2e. No shared tenant, no widened seed helper.",
  "- Red or flaky? Diagnose the cause first (https://github.com/CosmicDriftGameStudio/kumiko-framework/blob/main/docs/guides/test-failures.md). A longer timeout, a retry or `serial` is not a fix.",
  "- Run Playwright as `bunx --bun playwright`, as the scripts do.",
  `- Playwright configs and e2e files start with \`${TEST_RUNTIME_DIRECTIVE}\`; without it the runtime-isolation guard flags their import of the test package.`,
  "",
].join("\n");

function renderPlaywrightConfig(port: number): string {
  return [
    TEST_RUNTIME_DIRECTIVE,
    'import { defineAppE2eConfig } from "@cosmicdrift/kumiko-testing/e2e";',
    "",
    `export default defineAppE2eConfig({ port: ${port} });`,
    "",
  ].join("\n");
}

function renderE2eServer(appName: string): string {
  return [
    TEST_RUNTIME_DIRECTIVE,
    'import { randomUUID } from "node:crypto";',
    'import { runDevApp } from "@cosmicdrift/kumiko-dev-server";',
    'import { createE2eSeedRoutes } from "@cosmicdrift/kumiko-testing/e2e/seed-route";',
    'import { APP_FEATURES } from "../src/run-config";',
    "",
    "await runDevApp({",
    "  features: APP_FEATURES,",
    '  clientEntry: "./src/client.tsx",',
    "  extraRoutes: createE2eSeedRoutes(),",
    "  auth: {",
    "    admin: {",
    `      email: ${JSON.stringify(`admin@${appName}.local`)},`,
    "      password: randomUUID(),",
    '      displayName: "Admin",',
    "      emailVerified: true,",
    "      memberships: [],",
    "    },",
    "  },",
    "});",
    "",
  ].join("\n");
}

function renderE2eSmokeSpec(): string {
  return [
    TEST_RUNTIME_DIRECTIVE,
    'import type { SeedPart } from "@cosmicdrift/kumiko-testing";',
    'import { expect, test } from "@cosmicdrift/kumiko-testing/e2e";',
    'import type { Page } from "@playwright/test";',
    "",
    `const TASK_CREATE = ${JSON.stringify(TASK_CREATE)};`,
    "",
    "function withTask(title: string): SeedPart {",
    "  return async ({ tenant }) => {",
    '    await tenant.api.writeOk(TASK_CREATE, { title, status: "todo", priority: 1 });',
    "  };",
    "}",
    "",
    "async function openTasks(page: Page): Promise<void> {",
    '  await page.goto("/");',
    '  await page.getByRole("link", { name: "Tasks" }).first().click();',
    "}",
    "",
    'test("a seeded task shows up on the tasks screen", async ({ seedTenant, page }) => {',
    '  const tenant = await seedTenant({ with: [withTask("Water the plants")] });',
    "  await tenant.loginAs(page, tenant.admin);",
    "  await openTasks(page);",
    '  await expect(page.getByText("Water the plants")).toBeVisible();',
    "});",
    "",
    'test("a task stays invisible to another tenant", async ({ seedTenant, page }) => {',
    '  await seedTenant({ with: [withTask("Secret plans")] });',
    '  const other = await seedTenant({ with: [withTask("Own task")] });',
    "  await other.loginAs(page, other.admin);",
    "  await openTasks(page);",
    '  await expect(page.getByText("Own task")).toBeVisible();',
    '  await expect(page.getByText("Secret plans")).toHaveCount(0);',
    "});",
    "",
  ].join("\n");
}

function renderUnitTest(): string {
  return [
    'import { describe, expect, test } from "bun:test";',
    'import { createRegistry, validateBoot } from "@cosmicdrift/kumiko-framework/engine";',
    'import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";',
    'import { APP_FEATURES, HAS_AUTH } from "../run-config";',
    "",
    'describe("run-config", () => {',
    '  test("the mounted features pass boot validation and register the task handlers", () => {',
    "    const features = composeFeatures([...APP_FEATURES], { includeBundled: HAS_AUTH });",
    "    validateBoot(features);",
    "    const registry = createRegistry(features);",
    `    expect(registry.getWriteHandler(${JSON.stringify(TASK_CREATE)})).toBeDefined();`,
    `    expect(registry.getQueryHandler(${JSON.stringify(TASK_LIST)})).toBeDefined();`,
    "  });",
    "});",
    "",
  ].join("\n");
}

function renderIntegrationTest(): string {
  return [
    'import { afterAll, beforeAll, describe, expect, test } from "bun:test";',
    'import type { TestStack } from "@cosmicdrift/kumiko-framework/stack";',
    'import { seedTenant, setupAppTestStack } from "@cosmicdrift/kumiko-testing";',
    'import { tasksFeature } from "../features/tasks";',
    "",
    `const TASK_CREATE = ${JSON.stringify(TASK_CREATE)};`,
    `const TASK_LIST = ${JSON.stringify(TASK_LIST)};`,
    "",
    "type TaskList = { rows: { title: string }[] };",
    "",
    "let stack: TestStack;",
    "",
    "beforeAll(async () => {",
    "  stack = await setupAppTestStack([tasksFeature]);",
    "});",
    "",
    "afterAll(async () => {",
    "  await stack.cleanup();",
    "});",
    "",
    'describe("tasks", () => {',
    '  test("a created task is listed for its own tenant only", async () => {',
    "    const owner = await seedTenant(stack);",
    "    const other = await seedTenant(stack);",
    "",
    '    await owner.api.writeOk(TASK_CREATE, { title: "Write tests", status: "todo", priority: 1 });',
    "",
    "    const ownerTasks = await owner.api.queryOk<TaskList>(TASK_LIST, {});",
    '    expect(ownerTasks.rows.map((row) => row.title)).toEqual(["Write tests"]);',
    "    const otherTasks = await other.api.queryOk<TaskList>(TASK_LIST, {});",
    "    expect(otherTasks.rows).toEqual([]);",
    "  });",
    "});",
    "",
  ].join("\n");
}

export function renderTestSetup(input: RenderTestSetupInput): ScaffoldTestSetup {
  const { appName, frameworkVersion, port = SCAFFOLD_E2E_PORT } = input;
  return {
    files: {
      ...renderBunfigFiles({ install: { linker: "hoisted" } }),
      "playwright.config.ts": renderPlaywrightConfig(port),
      "e2e/server.ts": renderE2eServer(appName),
      "e2e/smoke.spec.ts": renderE2eSmokeSpec(),
      "src/__tests__/run-config.test.ts": renderUnitTest(),
      "src/__tests__/tasks.integration.test.ts": renderIntegrationTest(),
    },
    scripts: {
      test: `bun --config=${BUNFIG_FILES.unit} test --timeout=${TEST_TIMEOUT_MS.unit} --dots`,
      "test:integration": `bun kumiko-testing integration --parallel ${SCAFFOLD_INTEGRATION_PARALLEL}`,
      // bunfig.real.toml's pathIgnorePatterns can only blacklist (no "!" negation,
      // verified against bun 1.4), so it can't express "match only *.real.test.ts"
      // on its own — every *.test.ts file matches bun's default test glob too,
      // real.test.ts included. The positional filter narrows the run to files
      // whose path contains "real.test.ts", so an unfiltered test:real never
      // picks up the unit suite.
      "test:real": `${REAL_PROVIDERS_ENV}=1 bun --config=${BUNFIG_FILES.real} test --timeout=${TEST_TIMEOUT_MS.real} real.test.ts`,
      "test:bunfig": "bun kumiko-testing bunfig --hoisted",
      e2e: "bunx --bun playwright test",
      "e2e:real": `${REAL_PROVIDERS_ENV}=1 bunx --bun playwright test`,
    },
    devDependencies: {
      "@cosmicdrift/kumiko-testing": frameworkVersion,
      "@playwright/test": PLAYWRIGHT_VERSION,
    },
    rulesMarkdown: RULES_MARKDOWN,
  };
}
