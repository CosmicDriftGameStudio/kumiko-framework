import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../engine/index.js";
import { buildServer } from "../server.js";

const JWT_SECRET = "x".repeat(40);
const registry = createRegistry([]);

describe("buildServer — jwtTtl default depends on sessionChecker wiring", () => {
  test("no auth config → stateless default (1h)", () => {
    const { jwt } = buildServer({ registry, context: {}, jwtSecret: JWT_SECRET });
    expect(jwt.ttlSeconds).toBe(60 * 60);
  });

  test("auth without sessionChecker → stateless default (1h)", () => {
    const { jwt } = buildServer({
      registry,
      context: {},
      jwtSecret: JWT_SECRET,
      auth: { membershipQuery: "unused:query" },
    });
    expect(jwt.ttlSeconds).toBe(60 * 60);
  });

  test("auth with sessionChecker → session-backed default (8h)", () => {
    const { jwt } = buildServer({
      registry,
      context: {},
      jwtSecret: JWT_SECRET,
      auth: {
        membershipQuery: "unused:query",
        sessionChecker: async () => "live",
      },
    });
    expect(jwt.ttlSeconds).toBe(8 * 60 * 60);
  });

  test("explicit jwtTtl wins regardless of sessionChecker wiring", () => {
    const withChecker = buildServer({
      registry,
      context: {},
      jwtSecret: JWT_SECRET,
      jwtTtl: 42,
      auth: {
        membershipQuery: "unused:query",
        sessionChecker: async () => "live",
      },
    });
    expect(withChecker.jwt.ttlSeconds).toBe(42);

    const withoutChecker = buildServer({
      registry,
      context: {},
      jwtSecret: JWT_SECRET,
      jwtTtl: 42,
    });
    expect(withoutChecker.jwt.ttlSeconds).toBe(42);
  });
});

describe("buildServer — jwt keyring", () => {
  test("a signKid missing from keys fails at boot naming the kid, not the rate-limit digest", () => {
    expect(() =>
      buildServer({
        registry,
        context: {},
        jwtSecret: { keys: { k1: JWT_SECRET }, signKid: "k2" },
      }),
    ).toThrow('signKid "k2" is not present in the keyring');
  });
});
