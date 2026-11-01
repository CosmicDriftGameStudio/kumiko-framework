import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scaffoldApp } from "../scaffold-app.ts";

const FIXTURE_ROOT = join(import.meta.dir, ".tmp-fixtures");
const createdDirs: string[] = [];

afterAll(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

async function scaffoldBlank(name: string): Promise<string> {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  const root = mkdtempSync(join(FIXTURE_ROOT, "blank-"));
  createdDirs.push(root);
  const destination = join(root, name);
  await scaffoldApp({ name, destination, starter: "blank" });
  return destination;
}

async function bootBlank(
  destination: string,
  extraEnv: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn({
    cmd: ["bun", "bin/main.ts"],
    cwd: destination,
    // No process.env spread: the boot must not depend on DEMO_ADMIN_PASSWORD from the host.
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "",
      KUMIKO_DRY_RUN_ENV: "boot",
      JWT_SECRET: "j".repeat(48),
      KUMIKO_SECRETS_MASTER_KEY_V1: Buffer.alloc(32, 7).toString("base64"),
      DATABASE_URL: "postgres://dummy:dummy@127.0.0.1:1/dummy",
      REDIS_URL: "redis://127.0.0.1:1",
      PLATFORM_KEK: "",
      SUBJECT_KEYS_DATABASE_URL: "",
      KUMIKO_BLIND_INDEX_KEY: "",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("scaffoldApp starter blank", () => {
  test("writes no tasks demo, no seed file and no demo password", async () => {
    const dest = await scaffoldBlank("blank-files");
    for (const gone of [
      "src/features/tasks",
      "src/seed.ts",
      "e2e/smoke.spec.ts",
      "src/__tests__/tasks.integration.test.ts",
    ]) {
      expect(existsSync(join(dest, gone)), gone).toBe(false);
    }
    for (const file of ["bin/env-schema.ts", "bin/main.ts", ".env.example", "README.md"]) {
      expect(readFileSync(join(dest, file), "utf-8"), file).not.toContain("DEMO_ADMIN_PASSWORD");
    }
    expect(readFileSync(join(dest, "bin/main.ts"), "utf-8")).toContain("bootstrapAdminFromEnv");
    expect(readFileSync(join(dest, ".env.example"), "utf-8")).toContain(
      "KUMIKO_BOOTSTRAP_ADMIN_EMAIL=",
    );
    expect(readFileSync(join(dest, "src/run-config.ts"), "utf-8")).toContain(
      "createDeliveryFeature",
    );
  });

  // Each boot is a cold `bun bin/main.ts` that transpiles the framework; one boot per test
  // keeps every variant inside its own budget on a parallel CI runner.
  describe("boots without DEMO_ADMIN_PASSWORD", () => {
    let bootDestination = "";
    beforeAll(async () => {
      bootDestination = await scaffoldBlank("blank-boot");
    });

    test.each([
      ["without the bootstrap email", {}],
      ["with the bootstrap email", { KUMIKO_BOOTSTRAP_ADMIN_EMAIL: "creator@example.com" }],
    ] as const)("%s", async (_variant, extraEnv: Record<string, string>) => {
      const { stdout, stderr, code } = await bootBlank(bootDestination, extraEnv);
      expect(code, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);
      expect(stdout).toContain("boot validation OK");
      expect(`${stdout}${stderr}`).not.toContain("required, missing");
    });
  });
});
