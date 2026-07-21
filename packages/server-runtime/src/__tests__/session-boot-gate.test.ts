import { describe, expect, test } from "bun:test";
import { assertSessionBootInvariants } from "../session-boot-gate";

describe("assertSessionBootInvariants (#1372)", () => {
  test("no auth → no throw", () => {
    expect(() =>
      assertSessionBootInvariants({ hasAuth: false, sessionStoreProviderMounted: false }),
    ).not.toThrow();
  });

  test("auth + sessionStore → no throw", () => {
    expect(() =>
      assertSessionBootInvariants({ hasAuth: true, sessionStoreProviderMounted: true }),
    ).not.toThrow();
  });

  test("auth without sessionStore → throws", () => {
    expect(() =>
      assertSessionBootInvariants({ hasAuth: true, sessionStoreProviderMounted: false }),
    ).toThrow(/BOOT ABORTED/);
  });
});
