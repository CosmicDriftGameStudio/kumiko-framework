import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../engine";
import { buildServer } from "../server";

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

  test("auth with sessionChecker → session-backed default (24h)", () => {
    const { jwt } = buildServer({
      registry,
      context: {},
      jwtSecret: JWT_SECRET,
      auth: {
        membershipQuery: "unused:query",
        sessionChecker: async () => "live",
      },
    });
    expect(jwt.ttlSeconds).toBe(24 * 60 * 60);
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
