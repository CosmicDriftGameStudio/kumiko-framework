import { describe, expect, test } from "bun:test";
import {
  buildPgKmsOptions,
  type KmsWiringEnv,
  requireKmsWiring,
  resolveKmsWiring,
} from "../kms-wiring";

// 32 raw bytes -> base64, the shape PgKmsAdapter's decodePlatformKek demands.
const KEK_A = Buffer.alloc(32, 1).toString("base64");
const KEK_B = Buffer.alloc(32, 2).toString("base64");

const fullTrio: KmsWiringEnv = {
  PLATFORM_KEK: KEK_A,
  SUBJECT_KEYS_DATABASE_URL: "postgres://localhost:5432/subject_keys",
  KUMIKO_BLIND_INDEX_KEY: "blind-index-key",
};

const rotationEnv = {
  PLATFORM_KEK: KEK_A,
  SUBJECT_KEYS_DATABASE_URL: "postgres://localhost:5432/subject_keys",
};

describe("buildPgKmsOptions", () => {
  test("defaults kekVersion to 1 and omits previousKeks entirely when no rotation is active", () => {
    const options = buildPgKmsOptions(rotationEnv);

    expect(options.kekVersion).toBe(1);
    // Absent, not `undefined` — this is what distinguishes rotation-inactive
    // (the normal state of every app) from a half-configured rotation.
    expect("previousKeks" in options).toBe(false);
  });

  test("maps the previous KEK into the version slot named by the env var", () => {
    const options = buildPgKmsOptions({
      ...rotationEnv,
      PLATFORM_KEK_VERSION: "3",
      PLATFORM_KEK_PREVIOUS: KEK_B,
      PLATFORM_KEK_PREVIOUS_VERSION: "2",
    });

    expect(options.kekVersion).toBe(3);
    expect(options.previousKeks).toEqual({ 2: KEK_B });
  });

  // The bug this parser exists for: every one of these used to pass through
  // Number() and produce a wrong-but-silent version, which makes the rotation
  // slot unreachable and its rows unreadable (phronexsis#323).
  test.each([
    ["1e21", "scientific notation survives Number.isInteger"],
    ["0x10", "hex coerces to 16"],
    ["-1", "negative"],
    ["0", "zero is not a valid version"],
    [" 2 ", "whitespace is trimmed by Number"],
    ["2.5", "fractional"],
    ["abc", "not a number at all"],
  ])("rejects PLATFORM_KEK_VERSION=%p (%s)", (raw) => {
    expect(() => buildPgKmsOptions({ ...rotationEnv, PLATFORM_KEK_VERSION: raw })).toThrow(
      /PLATFORM_KEK_VERSION must be a positive integer/,
    );
  });

  // An empty env var is "unset", not "invalid" — `FOO=` in a .env file and an
  // absent FOO are the same thing to every shell and dotenv loader. Pinned
  // because it is the one falsy input that must NOT hit the strict parser.
  test("treats an empty PLATFORM_KEK_VERSION as unset", () => {
    expect(buildPgKmsOptions({ ...rotationEnv, PLATFORM_KEK_VERSION: "" }).kekVersion).toBe(1);
  });

  test("rejects a bad PLATFORM_KEK_PREVIOUS_VERSION with the same strictness", () => {
    expect(() =>
      buildPgKmsOptions({
        ...rotationEnv,
        PLATFORM_KEK_VERSION: "2",
        PLATFORM_KEK_PREVIOUS: KEK_B,
        PLATFORM_KEK_PREVIOUS_VERSION: "1e21",
      }),
    ).toThrow(/PLATFORM_KEK_PREVIOUS_VERSION must be a positive integer/);
  });

  test("rejects PLATFORM_KEK_PREVIOUS without its version", () => {
    expect(() => buildPgKmsOptions({ ...rotationEnv, PLATFORM_KEK_PREVIOUS: KEK_B })).toThrow(
      /PLATFORM_KEK_PREVIOUS_VERSION must be set/,
    );
  });
});

describe("resolveKmsWiring", () => {
  test("falls back to plaintext PII when the trio is entirely absent", () => {
    const wiring = resolveKmsWiring({});

    expect(wiring).toEqual({ allowPlaintextPii: "local dev without subject-keys KMS (fw#818)" });
  });

  test("carries an app-supplied fallback reason into the boot log", () => {
    const wiring = resolveKmsWiring({}, { plaintextReason: "solon pre-UI gate" });

    expect(wiring).toEqual({ allowPlaintextPii: "solon pre-UI gate" });
  });

  // All-or-none is the core of this module: a partial trio means someone
  // dropped one env var and would otherwise boot with unencrypted PII.
  test.each([
    ["PLATFORM_KEK", { PLATFORM_KEK: KEK_A }],
    ["SUBJECT_KEYS_DATABASE_URL", { SUBJECT_KEYS_DATABASE_URL: "postgres://localhost/x" }],
    ["KUMIKO_BLIND_INDEX_KEY", { KUMIKO_BLIND_INDEX_KEY: "key" }],
  ])("throws when only %s is set", (_name, env) => {
    expect(() => resolveKmsWiring(env)).toThrow(/all-or-none/);
  });

  test("prefixes the all-or-none error with the app's boot-log prefix", () => {
    expect(() => resolveKmsWiring({ PLATFORM_KEK: KEK_A }, { logPrefix: "[solon]" })).toThrow(
      /^\[solon\] PLATFORM_KEK/,
    );
  });

  test.each([
    ["PLATFORM_KEK_PREVIOUS without version", { PLATFORM_KEK_PREVIOUS: KEK_B }],
    ["version without PLATFORM_KEK_PREVIOUS", { PLATFORM_KEK_PREVIOUS_VERSION: "1" }],
  ])("throws on a half-configured rotation: %s", (_name, extra) => {
    expect(() => resolveKmsWiring({ ...fullTrio, ...extra })).toThrow(/must be set together/);
  });

  test("builds the adapter when the trio is complete", () => {
    const wiring = resolveKmsWiring(fullTrio);

    expect("kms" in wiring).toBe(true);
    if (!("kms" in wiring)) throw new Error("unreachable");
    expect(wiring.blindIndexKey).toBe("blind-index-key");
  });

  // Ownership check: the previous-version-must-be-older rule lives in
  // PgKmsAdapter's constructor, not here. Asserting on ITS message keeps that
  // documented — if the adapter ever stops enforcing it, this test breaks and
  // tells the next person the rule lost its home.
  test("leaves previous-version ordering to PgKmsAdapter, which rejects it", () => {
    expect(() =>
      resolveKmsWiring({
        ...fullTrio,
        PLATFORM_KEK_VERSION: "2",
        PLATFORM_KEK_PREVIOUS: KEK_B,
        PLATFORM_KEK_PREVIOUS_VERSION: "2",
      }),
    ).toThrow(/PgKmsAdapter: previousKeks\[2\] must be older than the active kekVersion 2/);
  });
});

describe("requireKmsWiring", () => {
  test("returns the active wiring without narrowing when the trio is complete", () => {
    // No `in` check needed at the call site — that is the point of the split.
    const { blindIndexKey } = requireKmsWiring(fullTrio);

    expect(blindIndexKey).toBe("blind-index-key");
  });

  test("throws instead of falling back when the trio is absent", () => {
    expect(() => requireKmsWiring({}, { logPrefix: "[money-horse]" })).toThrow(
      /no plaintext-PII opt-out on this entry point/,
    );
  });

  test("still reports a partial trio as all-or-none", () => {
    expect(() => requireKmsWiring({ PLATFORM_KEK: KEK_A })).toThrow(/all-or-none/);
  });
});
