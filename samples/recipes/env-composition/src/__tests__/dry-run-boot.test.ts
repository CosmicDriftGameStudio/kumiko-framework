import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { composeAppEnv } from "../env";

const serverEntry = join(import.meta.dir, "..", "..", "bin", "server.ts");

const completeValues = {
  DATABASE_URL: "postgres://app@127.0.0.1:1/app",
  REDIS_URL: "redis://127.0.0.1:1",
  JWT_SECRET: "j".repeat(32),
  KUMIKO_SECRETS_MASTER_KEY_V1: Buffer.alloc(32, 7).toString("base64"),
  DEMO_ADMIN_EMAIL: "admin@example.com",
  DEMO_SYSADMIN_EMAIL: "root@example.com",
  APP_PUBLIC_URL: "https://app.example.com",
};

// The child gets only these variables, never the test runner's env, so a
// DATABASE_URL on the CI host cannot leak into the "empty env" case.
async function runBootDryRun(variables: Readonly<Record<string, string>>) {
  const child = Bun.spawn([process.execPath, serverEntry], {
    env: { PATH: process.env["PATH"] ?? "", KUMIKO_DRY_RUN_ENV: "boot", ...variables },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function requiredVariableNames(): readonly string[] {
  const { schema } = composeAppEnv();
  return Object.entries(schema.shape)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([name]) => name);
}

describe("KUMIKO_DRY_RUN_ENV=boot", () => {
  test("exits 0 on an empty env and lists every required variable as missing", async () => {
    const { stdout, exitCode } = await runBootDryRun({});

    expect(exitCode).toBe(0);
    const required = requiredVariableNames();
    expect(required).toContain("DATABASE_URL");
    for (const name of [...required, "JWT_SECRET"]) {
      expect(stdout).toMatch(new RegExp(`^\\s+${name}\\s+\\S+\\s+required\\s+missing$`, "m"));
    }
    expect(stdout).toContain("Feature wiring was NOT validated");
  });

  test("exits 0 on an empty env with NODE_ENV=production", async () => {
    const { exitCode } = await runBootDryRun({ NODE_ENV: "production" });

    expect(exitCode).toBe(0);
  });

  test("validates the wiring once every required variable is set", async () => {
    const { stdout, exitCode } = await runBootDryRun(completeValues);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("All variables present.");
  });

  test("rejects a keyring the master-key provider cannot use", async () => {
    const { exitCode } = await runBootDryRun({
      ...completeValues,
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
    });

    expect(exitCode).toBe(1);
  });

  test("prints no value even when every variable is invalid", async () => {
    const { schema } = composeAppEnv();
    const leaking = Object.fromEntries(
      Object.keys(schema.shape).map((name) => [name, `LEAK_${name}`]),
    );
    const { stdout, stderr, exitCode } = await runBootDryRun(leaking);

    expect(exitCode).toBe(1);
    expect(`${stdout}${stderr}`).not.toContain("LEAK_");
  });

  test("exits 1 on an invalid value and never prints it", async () => {
    const endpoint = "http://s3.leak-check.example.com";
    const { stdout, stderr, exitCode } = await runBootDryRun({ S3_ENDPOINT: endpoint });

    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/S3_ENDPOINT\s+file-provider-s3-env\s+optional\s+invalid/);
    expect(`${stdout}${stderr}`).not.toContain("leak-check");
  });
});
