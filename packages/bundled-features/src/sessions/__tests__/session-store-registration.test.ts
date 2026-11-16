// sessions self-registers as auth-foundation's sessionStore provider
// instead of only being wired by hand into buildServer({ auth: { ... } }).

import { describe, expect, test } from "bun:test";
import {
  createAuthFoundationFeature,
  EXT_SESSION_STORE,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { createUserFeature } from "../../user/feature.ts";
import { createSessionsFeature } from "../feature.ts";
import { userSessionTable } from "../schema/user-session.ts";

describe("createSessionsFeature — sessionStore registration", () => {
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

describe("sessions cleanup job registration", () => {
  test("cleanup job runs once a day in the maintenance window and never overlaps", () => {
    const registry = createRegistry([
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserFeature(),
    ]);
    const job = registry.getJob("sessions:job:cleanup");
    expect(job?.trigger).toEqual({ maintenance: true });
    expect(job?.concurrency).toBe("skip");
  });
});

describe("store_user_sessions indexes", () => {
  test("store_user_sessions indexes userId for per-user lookups", () => {
    expect(userSessionTable.indexes).toContainEqual(
      expect.objectContaining({ name: "store_user_sessions_user_id_idx", columns: ["user_id"] }),
    );
  });
});
