import { describe, expect, test } from "bun:test";
import { resolveDeps } from "../dep-resolver";
import type { Manifest } from "../manifest";

const MANIFEST: Manifest = {
  source: "test",
  featureCount: 5,
  features: [
    {
      name: "auth-email-password",
      description: null,
      requires: ["user", "tenant"],
      optionalRequires: [],
    },
    { name: "user", description: null, requires: [], optionalRequires: [] },
    { name: "tenant", description: null, requires: ["config"], optionalRequires: [] },
    { name: "config", description: null, requires: [], optionalRequires: [] },
    { name: "billing", description: null, requires: ["tenant"], optionalRequires: [] },
  ],
};

describe("resolveDeps", () => {
  test("transitive requires close (auth → user + tenant + config)", () => {
    const result = resolveDeps(["auth-email-password"], MANIFEST);
    expect(new Set(result.featureNames)).toEqual(
      new Set(["auth-email-password", "user", "tenant", "config"]),
    );
    expect(new Set(result.autoAdded)).toEqual(new Set(["user", "tenant", "config"]));
  });

  test("dedupes overlapping deps", () => {
    const result = resolveDeps(["auth-email-password", "billing"], MANIFEST);
    expect(result.featureNames.length).toBe(new Set(result.featureNames).size);
    expect(new Set(result.featureNames)).toContain("tenant");
  });

  test("explicit selection NOT counted as autoAdded", () => {
    const result = resolveDeps(["user", "auth-email-password"], MANIFEST);
    expect(result.autoAdded).not.toContain("user");
    expect(result.autoAdded).toContain("tenant");
  });

  test("unknown feature throws (manifest bug)", () => {
    expect(() => resolveDeps(["does-not-exist"], MANIFEST)).toThrow(/not in manifest/);
  });
});
