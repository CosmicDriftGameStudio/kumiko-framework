import { describe, expect, test } from "vitest";
import { assertNoSecretLeak } from "../leak-guard";
import { createSecret } from "../types";

describe("assertNoSecretLeak — walks the response tree for branded values", () => {
  test("plain data passes through silently", () => {
    expect(() =>
      assertNoSecretLeak({
        id: "42",
        title: "foo",
        tags: ["a", "b"],
        nested: { deep: { value: 12 } },
      }),
    ).not.toThrow();
  });

  test("throws when Secret<> sits at the root", () => {
    const s = createSecret("plaintext-api-key");
    expect(() => assertNoSecretLeak(s)).toThrow(/leaked.*at \$/);
  });

  test("throws when Secret<> is nested in an object", () => {
    const payload = {
      id: "42",
      apiKey: createSecret("leak-me"),
    };
    expect(() => assertNoSecretLeak(payload)).toThrow(/leaked.*at \$\.apiKey/);
  });

  test("throws when Secret<> is inside an array", () => {
    const payload = {
      keys: [createSecret("one"), "two"],
    };
    expect(() => assertNoSecretLeak(payload)).toThrow(/leaked.*at \$\.keys\[0\]/);
  });

  test("reports path to the first offending node", () => {
    const payload = {
      outer: {
        middle: [null, { deeper: createSecret("gotcha") }],
      },
    };
    expect(() => assertNoSecretLeak(payload)).toThrow(/leaked.*at \$\.outer\.middle\[1\]\.deeper/);
  });

  test("skips opaque class instances (Date, Buffer) so they don't false-positive", () => {
    // Date and Buffer have internal slots the walker can't introspect — non-
    // plain prototype, no entry-iterator we trust. Stopping here is the
    // conservative call. Map and Set are NOT in this list (see next two tests):
    // they have well-defined iteration and a toJSON-via-custom-serializer can
    // expand them onto the wire, so we walk them.
    const payload = {
      createdAt: new Date("2024-01-01"),
      binary: Buffer.from("hello"),
    };
    expect(() => assertNoSecretLeak(payload)).not.toThrow();
  });

  test("walks Set entries and throws when Secret<> sits inside", () => {
    const payload = {
      keys: new Set([createSecret("hidden")]),
    };
    expect(() => assertNoSecretLeak(payload)).toThrow(/leaked.*at \$\.keys\.<set\[0\]>/);
  });

  test("walks Map values and throws when Secret<> sits inside", () => {
    const payload = {
      registry: new Map([["api", createSecret("hidden")]]),
    };
    expect(() => assertNoSecretLeak(payload)).toThrow(/leaked.*at \$\.registry\.<map\[0\]\.val>/);
  });

  test("Set of plain values stays silent — walking doesn't false-positive", () => {
    const payload = {
      ids: new Set(["a", "b"]),
      tags: new Map([["env", "prod"]]),
    };
    expect(() => assertNoSecretLeak(payload)).not.toThrow();
  });

  test("stops at MAX_DEPTH so cyclic or pathologically-deep input can't hang", () => {
    // Build a cyclic object — without the depth cap this would recurse forever.
    const root: Record<string, unknown> = { id: "root" };
    root["self"] = root;
    expect(() => assertNoSecretLeak(root)).not.toThrow();
  });

  test("undefined and null are no-ops", () => {
    expect(() => assertNoSecretLeak(undefined)).not.toThrow();
    expect(() => assertNoSecretLeak(null)).not.toThrow();
  });
});
