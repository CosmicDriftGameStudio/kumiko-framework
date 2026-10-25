// config-helpers unit tests.
//
// Pin the behavior of the narrowing helpers shared by the ai-/mail-/file-foundation
// packages, including the non-obvious edge cases: requireDefined narrows ONLY
// `undefined` (not falsy values), and requireNonEmpty has two separate error paths
// (undefined vs empty) that can be distinguished by the error message.

import { describe, expect, test } from "bun:test";
import { InternalError, UnconfiguredError } from "@cosmicdrift/kumiko-framework/errors";
import { requireDefined, requireNonEmpty } from "../config-helpers.ts";

describe("requireDefined", () => {
  test("undefined → throws with featureName + label + misconfiguration hint", () => {
    expect(() => requireDefined(undefined, "ai-foundation", "apiKey")).toThrow(
      "ai-foundation: 'apiKey' config key resolved to undefined — registry misconfigured (no value + no default)",
    );
  });

  test("undefined → throws InternalError (500): dev bug, not a tenant gap", () => {
    expect(() => requireDefined(undefined, "ai-foundation", "apiKey")).toThrow(InternalError);
  });

  test("defined value → returned unchanged", () => {
    expect(requireDefined("sk-123", "ai-foundation", "apiKey")).toBe("sk-123");
  });

  test("falsy-but-defined values pass (check is === undefined, not falsy)", () => {
    // A falsy check here would reject a numeric key with value 0
    // or an empty-string default. requireNonEmpty is the stricter helper.
    expect(requireDefined(0, "f", "n")).toBe(0);
    expect(requireDefined("", "f", "n")).toBe("");
    expect(requireDefined(false, "f", "n")).toBe(false);
    expect(requireDefined(null, "f", "n")).toBeNull();
  });

  test("object value → same reference returned (generic type preserved)", () => {
    const cfg = { host: "smtp.example.com", port: 587 };
    expect(requireDefined(cfg, "mail-foundation", "smtp")).toBe(cfg);
  });
});

describe("requireNonEmpty", () => {
  test("undefined → throws the requireDefined message (delegated, NOT the empty path)", () => {
    expect(() => requireNonEmpty(undefined, "mail-foundation", "host")).toThrow(
      "config key resolved to undefined",
    );
  });

  test("empty string → throws empty-message with default uiHint", () => {
    expect(() => requireNonEmpty("", "file-foundation", "bucket")).toThrow(
      "file-foundation: 'bucket' is empty — tenant must configure it before use. Set via tenant-admin UI or seed-handler.",
    );
  });

  test("empty string → throws UnconfiguredError (422, code unconfigured, typed details)", () => {
    try {
      requireNonEmpty("", "file-foundation", "bucket");
      throw new Error("expected requireNonEmpty to throw");
    } catch (err) {
      if (!(err instanceof UnconfiguredError)) throw err;
      expect(err.code).toBe("unconfigured");
      expect(err.httpStatus).toBe(422);
      expect(err.details).toMatchObject({ feature: "file-foundation", key: "bucket" });
    }
  });

  test("empty string with custom uiHint → hint appears in the message", () => {
    expect(() =>
      requireNonEmpty("", "ai-foundation", "model", "Choose a model in Settings → AI."),
    ).toThrow("is empty — tenant must configure it before use. Choose a model in Settings → AI.");
  });

  test("non-empty value → returned unchanged", () => {
    expect(requireNonEmpty("smtp.example.com", "mail-foundation", "host")).toBe("smtp.example.com");
  });

  test("pure whitespace → throws empty-message (trimmed, treated as empty)", () => {
    expect(() => requireNonEmpty("   ", "mail-foundation", "host")).toThrow(
      "mail-foundation: 'host' is empty — tenant must configure it before use.",
    );
  });

  test("surrounding whitespace is trimmed from the return value", () => {
    expect(requireNonEmpty("  smtp.example.com  ", "mail-foundation", "host")).toBe(
      "smtp.example.com",
    );
  });
});
