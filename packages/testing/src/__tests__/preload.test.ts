import { describe, expect, test } from "bun:test";
import { SCHEMA_ENV_DEFAULTS } from "../preload/schema-env-defaults-values";
import { SERVICE_ENV_DEFAULTS } from "../preload/service-env-defaults-values";
import { PROVIDER_ENV_KEYS, scrubProviderEnv } from "../provider-env-keys";

type PreloadRun = { readonly exitCode: number; readonly stdout: string; readonly stderr: string };

const PROBE = "console.log(JSON.stringify(process.env))";

// Strips every key a preload under test might default, not just DATABASE_URL —
// a host that happens to export e.g. REDIS_URL or a master-key env would
// otherwise make a "stays unset" assertion pass for the wrong reason.
const DEFAULTABLE_KEYS = [
  ...Object.keys(SCHEMA_ENV_DEFAULTS),
  ...Object.keys(SERVICE_ENV_DEFAULTS),
];

function runWithPreload(
  preload: string,
  env: Record<string, string>,
  probe: string = PROBE,
): PreloadRun {
  const inherited = { ...process.env };
  for (const key of [
    ...PROVIDER_ENV_KEYS,
    ...DEFAULTABLE_KEYS,
    "CI",
    "KUMIKO_REAL_PROVIDERS",
    "KUMIKO_INSTANCE_ID",
  ]) {
    delete inherited[key];
  }
  const result = Bun.spawnSync(
    ["bun", "--preload", `@cosmicdrift/kumiko-testing/preload/${preload}`, "-e", probe],
    { env: { ...inherited, ...env }, stdout: "pipe", stderr: "pipe" },
  );
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function envOf(run: PreloadRun): Record<string, string | undefined> {
  return JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}") as Record<
    string,
    string | undefined
  >;
}

describe("preload/env", () => {
  test("removes every provider key and leaves other variables untouched", () => {
    const providerEnv = Object.fromEntries(PROVIDER_ENV_KEYS.map((key) => [key, `real-${key}`]));
    const run = runWithPreload("env", { ...providerEnv, UNRELATED_SETTING: "kept" });

    expect(run.exitCode).toBe(0);
    const env = envOf(run);
    for (const key of PROVIDER_ENV_KEYS) expect(env[key]).toBeUndefined();
    expect(env["UNRELATED_SETTING"]).toBe("kept");
  });

  test("fills service and schema defaults only where the variable is unset", () => {
    const run = runWithPreload("env", { REDIS_URL: "redis://custom:1" });

    const env = envOf(run);
    expect(env["REDIS_URL"]).toBe("redis://custom:1");
    for (const [key, value] of Object.entries(SERVICE_ENV_DEFAULTS)) {
      if (key === "REDIS_URL") continue;
      expect(env[key]).toBe(value);
    }
    for (const [key, value] of Object.entries(SCHEMA_ENV_DEFAULTS)) expect(env[key]).toBe(value);
  });
});

describe("preload/scrub-env", () => {
  test("removes provider keys without adding service or schema defaults", () => {
    const run = runWithPreload("scrub-env", { ANTHROPIC_API_KEY: "sk-ant-real" });

    expect(run.exitCode).toBe(0);
    const env = envOf(run);
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
    for (const key of DEFAULTABLE_KEYS) expect(env[key]).toBeUndefined();
  });
});

describe("preload/schema-env-defaults", () => {
  test("fills every schema default only where the variable is unset", () => {
    const kept = "a-jwt-secret-that-is-at-least-32-characters-long";
    const env = envOf(runWithPreload("schema-env-defaults", { JWT_SECRET: kept }));

    expect(env["JWT_SECRET"]).toBe(kept);
    for (const [key, value] of Object.entries(SCHEMA_ENV_DEFAULTS)) {
      if (key === "JWT_SECRET") continue;
      expect(env[key]).toBe(value);
    }
  });

  test("replaces a JWT_SECRET shorter than 32 chars, same as the app-local preloads it replaces", () => {
    const env = envOf(runWithPreload("schema-env-defaults", { JWT_SECRET: "too-short" }));

    expect(env["JWT_SECRET"]).toBe(SCHEMA_ENV_DEFAULTS.JWT_SECRET);
  });

  test("sets no service endpoints, unlike preload/env", () => {
    const env = envOf(runWithPreload("schema-env-defaults", {}));

    for (const key of Object.keys(SERVICE_ENV_DEFAULTS)) expect(env[key]).toBeUndefined();
  });
});

describe("scrubProviderEnv", () => {
  test("deletes exactly the listed keys", () => {
    const env: Record<string, string | undefined> = { STRIPE_API_KEY: "sk_test_x", KEEP: "1" };
    scrubProviderEnv(env);
    expect(env).toEqual({ KEEP: "1" });
  });
});

describe("preload/real", () => {
  test("refuses to run without KUMIKO_REAL_PROVIDERS=1, even with a provider key present", () => {
    const run = runWithPreload("real", { ANTHROPIC_API_KEY: "sk-ant-real" });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("KUMIKO_REAL_PROVIDERS=1");
  });

  test("refuses to run in CI even with the flag set", () => {
    const run = runWithPreload("real", { KUMIKO_REAL_PROVIDERS: "1", CI: "true" });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("never run in CI");
  });

  test("with the flag set outside CI it keeps the provider keys", () => {
    const run = runWithPreload("real", {
      KUMIKO_REAL_PROVIDERS: "1",
      ANTHROPIC_API_KEY: "sk-ant-real",
    });

    expect(run.exitCode).toBe(0);
    const env = envOf(run);
    expect(env["ANTHROPIC_API_KEY"]).toBe("sk-ant-real");
    for (const [key, value] of Object.entries(SERVICE_ENV_DEFAULTS)) expect(env[key]).toBe(value);
    for (const [key, value] of Object.entries(SCHEMA_ENV_DEFAULTS)) expect(env[key]).toBe(value);
  });
});

describe("preload/temporal", () => {
  test("installs Temporal and defaults the instance id without overriding it", () => {
    const probe = "console.log(JSON.stringify({ ...process.env, hasTemporal: typeof Temporal }))";

    const defaulted = envOf(runWithPreload("temporal", {}, probe));
    expect(defaulted["hasTemporal"]).toBe("object");
    expect(defaulted["KUMIKO_INSTANCE_ID"]).toBe("test-instance");

    const explicit = envOf(runWithPreload("temporal", { KUMIKO_INSTANCE_ID: "mine" }, probe));
    expect(explicit["KUMIKO_INSTANCE_ID"]).toBe("mine");
  });
});

describe("preload/ci-log", () => {
  test("announces the CI profile", () => {
    const run = runWithPreload("ci-log", {});

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("[kumiko-test] CI profile active");
  });
});
