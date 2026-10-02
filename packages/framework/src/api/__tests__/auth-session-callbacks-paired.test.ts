import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../engine/index.js";
import { assertSessionCallbacksPaired } from "../auth-routes.js";
import { buildServer } from "../server.js";

const sessionCreator = async (): Promise<string> => "sid-1";
const sessionRevoker = async (): Promise<void> => {};
const sessionChecker = async (): Promise<"live"> => "live";

describe("assertSessionCallbacksPaired", () => {
  test("no auth config and stateless JWTs (no callbacks) boot", () => {
    expect(() => assertSessionCallbacksPaired(undefined)).not.toThrow();
    expect(() => assertSessionCallbacksPaired({})).not.toThrow();
  });

  test("all three callbacks boot", () => {
    expect(() =>
      assertSessionCallbacksPaired({ sessionCreator, sessionRevoker, sessionChecker }),
    ).not.toThrow();
  });

  test("a checker alone boots, it fails closed on sidless JWTs", () => {
    expect(() => assertSessionCallbacksPaired({ sessionChecker })).not.toThrow();
  });

  test("creator and revoker without a checker refuse to boot", () => {
    expect(() => assertSessionCallbacksPaired({ sessionCreator, sessionRevoker })).toThrow(
      /missing sessionChecker/,
    );
  });

  test("creator without a revoker refuses to boot", () => {
    expect(() => assertSessionCallbacksPaired({ sessionCreator, sessionChecker })).toThrow(
      /missing sessionRevoker/,
    );
  });

  test("buildServer enforces it", () => {
    expect(() =>
      buildServer({
        registry: createRegistry([]),
        context: {},
        jwtSecret: "session-callbacks-paired-test-secret-32-chars!!",
        auth: { membershipQuery: "tenant:query:memberships", sessionCreator, sessionRevoker },
      }),
    ).toThrow(/missing sessionChecker/);
  });
});
