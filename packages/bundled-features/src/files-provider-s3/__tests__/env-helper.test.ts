import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parseS3EnvConfig } from "../env-helper";

// Tests run against real process.env — we snapshot + restore per-test so
// parallel test files don't leak env vars into one another. vi.stubEnv is
// intentionally avoided: it only affects Vite-transformed reads, and
// env-helper reads process.env directly at runtime.

const TOUCHED_KEYS = [
  "TEST_S3_BUCKET",
  "TEST_S3_REGION",
  "TEST_S3_ACCESS_KEY",
  "TEST_S3_SECRET_KEY",
  "TEST_S3_ENDPOINT",
  "TEST_S3_FORCE_PATH_STYLE",
  "OTHER_BUCKET",
  "OTHER_REGION",
  "OTHER_ACCESS_KEY",
  "OTHER_SECRET_KEY",
];

const snapshot = new Map<string, string | undefined>();

beforeEach(() => {
  snapshot.clear();
  for (const k of TOUCHED_KEYS) {
    snapshot.set(k, process.env[k]);
    delete process.env[k];
  }
});

afterEach(() => {
  for (const [k, v] of snapshot) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function setRequired(prefix = "TEST_S3_"): void {
  process.env[`${prefix}BUCKET`] = "my-bucket";
  process.env[`${prefix}REGION`] = "us-east-1";
  process.env[`${prefix}ACCESS_KEY`] = "access";
  process.env[`${prefix}SECRET_KEY`] = "secret";
}

describe("parseS3EnvConfig — required vars", () => {
  test("throws missing_env when BUCKET is absent", () => {
    setRequired();
    delete process.env["TEST_S3_BUCKET"];
    expect(() => parseS3EnvConfig("TEST_S3_")).toThrow(/missing_env.*TEST_S3_BUCKET/);
  });

  test("throws missing_env when REGION is absent", () => {
    setRequired();
    delete process.env["TEST_S3_REGION"];
    expect(() => parseS3EnvConfig("TEST_S3_")).toThrow(/missing_env.*TEST_S3_REGION/);
  });

  test("throws missing_env when ACCESS_KEY is absent", () => {
    setRequired();
    delete process.env["TEST_S3_ACCESS_KEY"];
    expect(() => parseS3EnvConfig("TEST_S3_")).toThrow(/missing_env.*TEST_S3_ACCESS_KEY/);
  });

  test("throws missing_env when SECRET_KEY is absent", () => {
    setRequired();
    delete process.env["TEST_S3_SECRET_KEY"];
    expect(() => parseS3EnvConfig("TEST_S3_")).toThrow(/missing_env.*TEST_S3_SECRET_KEY/);
  });

  test("treats empty string as missing (CI that exports VAR='' to unset)", () => {
    setRequired();
    process.env["TEST_S3_BUCKET"] = "";
    expect(() => parseS3EnvConfig("TEST_S3_")).toThrow(/missing_env.*TEST_S3_BUCKET/);
  });

  test("passes required vars straight through", () => {
    setRequired();
    const config = parseS3EnvConfig("TEST_S3_");
    expect(config.bucket).toBe("my-bucket");
    expect(config.region).toBe("us-east-1");
    expect(config.accessKeyId).toBe("access");
    expect(config.secretAccessKey).toBe("secret");
  });
});

describe("parseS3EnvConfig — optional ENDPOINT", () => {
  test("undefined endpoint → omitted from config (AWS default behaviour)", () => {
    setRequired();
    const config = parseS3EnvConfig("TEST_S3_");
    expect(config.endpoint).toBeUndefined();
  });

  test("empty-string endpoint → omitted (don't forward '' to SDK)", () => {
    setRequired();
    process.env["TEST_S3_ENDPOINT"] = "";
    const config = parseS3EnvConfig("TEST_S3_");
    expect(config.endpoint).toBeUndefined();
  });

  test("non-empty endpoint → forwarded verbatim", () => {
    setRequired();
    process.env["TEST_S3_ENDPOINT"] = "https://r2.example.com";
    const config = parseS3EnvConfig("TEST_S3_");
    expect(config.endpoint).toBe("https://r2.example.com");
  });
});

describe("parseS3EnvConfig — FORCE_PATH_STYLE parsing", () => {
  test("undefined → config has no forcePathStyle (auto-detect at provider level)", () => {
    setRequired();
    const config = parseS3EnvConfig("TEST_S3_");
    expect(config.forcePathStyle).toBeUndefined();
  });

  test("'true' → forcePathStyle: true", () => {
    setRequired();
    process.env["TEST_S3_FORCE_PATH_STYLE"] = "true";
    expect(parseS3EnvConfig("TEST_S3_").forcePathStyle).toBe(true);
  });

  test("'false' → forcePathStyle: false (explicit AWS-style override)", () => {
    setRequired();
    process.env["TEST_S3_FORCE_PATH_STYLE"] = "false";
    expect(parseS3EnvConfig("TEST_S3_").forcePathStyle).toBe(false);
  });

  test("any other non-'true' value → treated as false (strict parse)", () => {
    setRequired();
    process.env["TEST_S3_FORCE_PATH_STYLE"] = "yes";
    // Only the literal string "true" flips the flag on. Prevents typos
    // like "True" / "1" from silently enabling a non-default behaviour.
    expect(parseS3EnvConfig("TEST_S3_").forcePathStyle).toBe(false);
  });
});

describe("parseS3EnvConfig — prefix variants", () => {
  test("custom prefix reads independent env vars", () => {
    process.env["OTHER_BUCKET"] = "other-bucket";
    process.env["OTHER_REGION"] = "eu-west-1";
    process.env["OTHER_ACCESS_KEY"] = "other-access";
    process.env["OTHER_SECRET_KEY"] = "other-secret";

    const config = parseS3EnvConfig("OTHER_");
    expect(config.bucket).toBe("other-bucket");
    expect(config.region).toBe("eu-west-1");
  });

  test("different prefixes don't bleed config into each other", () => {
    setRequired("TEST_S3_");
    process.env["OTHER_BUCKET"] = "other-bucket";
    process.env["OTHER_REGION"] = "eu-west-1";
    process.env["OTHER_ACCESS_KEY"] = "other-access";
    process.env["OTHER_SECRET_KEY"] = "other-secret";

    const a = parseS3EnvConfig("TEST_S3_");
    const b = parseS3EnvConfig("OTHER_");
    expect(a.bucket).toBe("my-bucket");
    expect(b.bucket).toBe("other-bucket");
  });
});
