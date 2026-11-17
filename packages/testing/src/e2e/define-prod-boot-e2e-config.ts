import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { E2E_TIMEOUT_MS } from "../e2e-timeouts";
import { infraEnvDefaults } from "./define-app-e2e-config";

export type ProdBootE2eConfigInput = {
  readonly port: number;
  /** Built server bundle, relative to the app root. Default "dist-server/server.js". */
  readonly serverEntry?: string;
  /** Built kumiko CLI that the migrate initContainer runs. Default "dist-server/kumiko.js". */
  readonly cliEntry?: string;
  /** App env on top of the infra defaults and the throwaway KMS/SMTP values. */
  readonly env?: Readonly<Record<string, string>>;
  /** Default "./e2e-prod-boot". */
  readonly testDir?: string;
};

const DEFAULT_SERVER_ENTRY = "dist-server/server.js";
const DEFAULT_CLI_ENTRY = "dist-server/kumiko.js";
const DEFAULT_TEST_DIR = "./e2e-prod-boot";

// The production boot needs a KMS and an SMTP host; throwaway values keep real secrets out of app configs.
export function prodBootEnvDefaults(): Record<string, string> {
  return {
    PLATFORM_KEK: randomBytes(32).toString("base64"),
    KUMIKO_BLIND_INDEX_KEY: randomBytes(32).toString("base64"),
    SMTP_HOST: "127.0.0.1",
  };
}

export function defineProdBootE2eConfig(input: ProdBootE2eConfigInput): PlaywrightTestConfig {
  const {
    port,
    serverEntry = DEFAULT_SERVER_ENTRY,
    cliEntry = DEFAULT_CLI_ENTRY,
    env = {},
    testDir = DEFAULT_TEST_DIR,
  } = input;
  const launcher = fileURLToPath(new URL("./prod-boot-server.ts", import.meta.url));

  return defineConfig({
    testDir,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: !!process.env["CI"],
    reporter: [["list"]],
    timeout: E2E_TIMEOUT_MS.test,
    expect: { timeout: E2E_TIMEOUT_MS.expect },
    use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${port}` },
    projects: [{ name: "prod-boot", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
      command: `bun ${launcher} ${serverEntry} ${cliEntry}`,
      url: `http://localhost:${port}/health`,
      env: {
        ...infraEnvDefaults(),
        ...prodBootEnvDefaults(),
        ...env,
        PORT: String(port),
        NODE_ENV: "production",
      },
      reuseExistingServer: false,
      timeout: E2E_TIMEOUT_MS.webServer,
      stdout: "pipe",
      stderr: "pipe",
    },
  });
}
