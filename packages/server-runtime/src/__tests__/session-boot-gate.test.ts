import { describe, expect, spyOn, test } from "bun:test";
import { assertSessionBootInvariants } from "../session-boot-gate";

describe("assertSessionBootInvariants (#1372)", () => {
  test("no auth → no throw", () => {
    expect(() =>
      assertSessionBootInvariants({
        hasAuth: false,
        sessionStoreProviderMounted: false,
        mode: "prod",
      }),
    ).not.toThrow();
  });

  test("auth + sessionStore → no throw", () => {
    expect(() =>
      assertSessionBootInvariants({
        hasAuth: true,
        sessionStoreProviderMounted: true,
        mode: "prod",
      }),
    ).not.toThrow();
  });

  test("prod: auth without sessionStore → BOOT ABORTED throw", () => {
    expect(() =>
      assertSessionBootInvariants({
        hasAuth: true,
        sessionStoreProviderMounted: false,
        mode: "prod",
      }),
    ).toThrow(/BOOT ABORTED/);
  });
});

// dev/prod split (#2027) — dev-server had no equivalent gate at all before
// this: a forgotten sessions mount silently left session-list empty with no
// signal. Mirrors assertPiiBootInvariants' dev/prod split (warn vs abort).
describe("assertSessionBootInvariants — dev mode (#2027)", () => {
  test("dev: auth without sessionStore → warns, does NOT throw", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() =>
        assertSessionBootInvariants({
          hasAuth: true,
          sessionStoreProviderMounted: false,
          mode: "dev",
        }),
      ).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("sessionStore"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[runDevApp]"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("dev: auth + sessionStore → no throw, no warn", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      assertSessionBootInvariants({
        hasAuth: true,
        sessionStoreProviderMounted: true,
        mode: "dev",
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
