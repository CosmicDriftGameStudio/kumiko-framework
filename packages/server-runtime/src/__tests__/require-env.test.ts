// requireEnv — the missing-var error message must match the actual caller.
// Regression (728/2): the advice text was hardcoded to prod/container
// wording ("Coolify secrets") regardless of the `context` param, so a
// runDevApp caller got misleading production-deploy instructions for a
// missing local .env var.

import { describe, expect, test } from "bun:test";
import { requireEnv } from "../run-prod-app";

describe("requireEnv", () => {
  test("default context (runProdApp) gives container/production advice", () => {
    expect(() => requireEnv("MISSING_VAR", {})).toThrow(/container env.*Coolify secrets/);
  });

  test("runDevApp context gives local .env advice, not production advice", () => {
    expect(() => requireEnv("MISSING_VAR", {}, "runDevApp")).toThrow(
      /\.env \/ shell before running the dev server/,
    );
  });

  test("runDevApp context error does NOT mention Coolify", () => {
    try {
      requireEnv("MISSING_VAR", {}, "runDevApp");
      throw new Error("expected requireEnv to throw");
    } catch (err) {
      expect(String(err)).not.toContain("Coolify");
    }
  });
});
