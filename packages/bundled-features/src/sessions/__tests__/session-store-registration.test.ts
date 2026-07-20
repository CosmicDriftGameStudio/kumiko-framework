// sessions self-registers as auth-foundation's sessionStore provider (#1371)
// instead of only being wired by hand into buildServer({ auth: { ... } }).

import { describe, expect, test } from "bun:test";
import { EXT_SESSION_STORE } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createSessionsFeature } from "../feature";

describe("createSessionsFeature — sessionStore registration (#1371)", () => {
  test('registers via r.useExtension(EXT_SESSION_STORE, "default", ...)', () => {
    const feature = createSessionsFeature();
    const usage = feature.extensionUsages.find((u) => u.extensionName === EXT_SESSION_STORE);
    expect(usage).toBeDefined();
    expect(usage?.entityName).toBe("default");
    expect(typeof (usage?.options as { build?: unknown } | undefined)?.build).toBe("function");
  });

  test("requires auth-foundation (owner of EXT_SESSION_STORE)", () => {
    const feature = createSessionsFeature();
    expect(feature.requires).toContain("auth-foundation");
  });
});
