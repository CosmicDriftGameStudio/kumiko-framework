import { describe, expect, test } from "bun:test";
import { assertSessionBootInvariants } from "../session-boot-gate";

describe("assertSessionBootInvariants", () => {
  test("no auth mounted → nothing to gate", () => {
    expect(() =>
      assertSessionBootInvariants({
        hasAuth: false,
        sessionsFeatureMounted: false,
        sessionsOption: undefined,
      }),
    ).not.toThrow();
  });

  test("auth mounted, sessions feature missing, no opt-out → aborts boot", () => {
    expect(() =>
      assertSessionBootInvariants({
        hasAuth: true,
        sessionsFeatureMounted: false,
        sessionsOption: undefined,
      }),
    ).toThrow(/BOOT ABORTED.*sessions.*stateless/s);
  });

  test("auth mounted, sessions feature missing, explicit sessions:false → boots", () => {
    expect(() =>
      assertSessionBootInvariants({
        hasAuth: true,
        sessionsFeatureMounted: false,
        sessionsOption: false,
      }),
    ).not.toThrow();
  });

  test("auth mounted, sessions feature wired → boots", () => {
    expect(() =>
      assertSessionBootInvariants({
        hasAuth: true,
        sessionsFeatureMounted: true,
        sessionsOption: undefined,
      }),
    ).not.toThrow();
  });

  test("auth mounted, sessions feature wired AND an expiresInMs override → boots", () => {
    expect(() =>
      assertSessionBootInvariants({
        hasAuth: true,
        sessionsFeatureMounted: true,
        sessionsOption: { expiresInMs: 60_000 },
      }),
    ).not.toThrow();
  });
});
