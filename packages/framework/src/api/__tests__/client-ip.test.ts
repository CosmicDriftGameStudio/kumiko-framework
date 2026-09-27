// Unit tests for the single client-IP resolver shared by requestIdMiddleware,
// rate-limit/middleware.ts (L1/L2) and auth-routes.ts.
// No Hono/HTTP plumbing here — see request-id-middleware.test.ts,
// auth-routes-trusted-proxy.test.ts and rate-limit/__tests__/
// middleware.integration.test.ts for the end-to-end behavior.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  assertValidTrustedProxyHops,
  type ClientIpHeaderSource,
  createClientIpResolver,
  parseTrustedProxyHopsEnv,
} from "../client-ip";

function sourceOf(headers: Record<string, string>, socketAddress?: string): ClientIpHeaderSource {
  return {
    header: (name) => headers[name],
    ...(socketAddress !== undefined ? { socketAddress } : {}),
  };
}

describe("createClientIpResolver", () => {
  describe("hops = 0 (default): trust no proxy header", () => {
    test("ignores x-forwarded-for and falls back to the socket address", () => {
      const resolver = createClientIpResolver(0);
      const ip = resolver.resolve(sourceOf({ "x-forwarded-for": "203.0.113.7" }, "10.1.1.1"));
      expect(ip).toBe("10.1.1.1");
    });

    test("falls back to 'unknown' when there's no socket address either", () => {
      const resolver = createClientIpResolver(0);
      expect(resolver.resolve(sourceOf({ "x-forwarded-for": "203.0.113.7" }))).toBe("unknown");
    });

    test("ignores x-real-ip too — hops=0 trusts nothing but the socket", () => {
      const resolver = createClientIpResolver(0);
      expect(resolver.resolve(sourceOf({ "x-real-ip": "203.0.113.7" }, "10.1.1.1"))).toBe(
        "10.1.1.1",
      );
    });

    describe("warns exactly once per resolver instance when XFF arrives", () => {
      let warnSpy: ReturnType<typeof spyOn>;

      afterEach(() => {
        warnSpy?.mockRestore();
      });

      test("logs a single console.warn across repeated requests with XFF", () => {
        warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        const resolver = createClientIpResolver(0);
        resolver.resolve(sourceOf({ "x-forwarded-for": "203.0.113.7" }));
        resolver.resolve(sourceOf({ "x-forwarded-for": "203.0.113.8" }));
        resolver.resolve(sourceOf({ "x-forwarded-for": "203.0.113.9" }));
        expect(warnSpy).toHaveBeenCalledTimes(1);
      });

      test("a fresh resolver instance warns again — the flag isn't a module singleton", () => {
        warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        createClientIpResolver(0).resolve(sourceOf({ "x-forwarded-for": "203.0.113.7" }));
        createClientIpResolver(0).resolve(sourceOf({ "x-forwarded-for": "203.0.113.7" }));
        expect(warnSpy).toHaveBeenCalledTimes(2);
      });

      test("no warning when XFF is absent or blank", () => {
        warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        const resolver = createClientIpResolver(0);
        resolver.resolve(sourceOf({}));
        resolver.resolve(sourceOf({ "x-forwarded-for": "   " }));
        expect(warnSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("hops = 1: last XFF entry is the real client", () => {
    test("picks the last entry, ignoring a spoofed leading entry", () => {
      const resolver = createClientIpResolver(1);
      const ip = resolver.resolve(sourceOf({ "x-forwarded-for": "attacker-claim, 9.9.9.9" }));
      expect(ip).toBe("9.9.9.9");
    });

    test("a different spoofed leading entry doesn't change the resolved IP", () => {
      const resolver = createClientIpResolver(1);
      const first = resolver.resolve(sourceOf({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }));
      const second = resolver.resolve(sourceOf({ "x-forwarded-for": "5.6.7.8, 9.9.9.9" }));
      expect(first).toBe("9.9.9.9");
      expect(second).toBe("9.9.9.9");
    });

    test("a single-entry chain resolves to that entry directly", () => {
      const resolver = createClientIpResolver(1);
      expect(resolver.resolve(sourceOf({ "x-forwarded-for": "9.9.9.9" }))).toBe("9.9.9.9");
    });

    test("no XFF: falls back to x-real-ip", () => {
      const resolver = createClientIpResolver(1);
      expect(resolver.resolve(sourceOf({ "x-real-ip": "203.0.113.10" }))).toBe("203.0.113.10");
    });

    test("no XFF and no x-real-ip: falls back to the socket address", () => {
      const resolver = createClientIpResolver(1);
      expect(resolver.resolve(sourceOf({}, "10.2.2.2"))).toBe("10.2.2.2");
    });

    test("no XFF, no x-real-ip, no socket address: falls back to 'unknown', never skips", () => {
      const resolver = createClientIpResolver(1);
      expect(resolver.resolve(sourceOf({}))).toBe("unknown");
    });

    test("empty/whitespace-only XFF is treated as absent, not as a blank entry", () => {
      const resolver = createClientIpResolver(1);
      expect(resolver.resolve(sourceOf({ "x-forwarded-for": "   " }, "10.3.3.3"))).toBe("10.3.3.3");
    });
  });

  describe("hops = 2: chain shorter than configured hops falls back", () => {
    test("a single-entry chain (shorter than 2 hops) falls back to x-real-ip", () => {
      const resolver = createClientIpResolver(2);
      expect(
        resolver.resolve(sourceOf({ "x-forwarded-for": "9.9.9.9", "x-real-ip": "203.0.113.11" })),
      ).toBe("203.0.113.11");
    });

    test("a two-entry chain resolves to the leftmost (first) trusted-hop entry", () => {
      const resolver = createClientIpResolver(2);
      expect(resolver.resolve(sourceOf({ "x-forwarded-for": "6.6.6.6, 7.7.7.7" }))).toBe("6.6.6.6");
    });
  });

  test("assertValidTrustedProxyHops rejects negative and non-integer values", () => {
    expect(() => assertValidTrustedProxyHops(-1, "test")).toThrow(/non-negative integer/);
    expect(() => assertValidTrustedProxyHops(1.5, "test")).toThrow(/non-negative integer/);
    expect(() => assertValidTrustedProxyHops(0, "test")).not.toThrow();
    expect(() => assertValidTrustedProxyHops(undefined, "test")).not.toThrow();
  });

  test("createClientIpResolver fails loud on an invalid trustedProxyHops instead of silently degrading", () => {
    expect(() => createClientIpResolver(-1, "test")).toThrow(/non-negative integer/);
  });
});

describe("parseTrustedProxyHopsEnv", () => {
  test("undefined -> undefined (no env set)", () => {
    expect(parseTrustedProxyHopsEnv(undefined, "test")).toBeUndefined();
  });

  test("valid digits-only string -> parsed integer", () => {
    expect(parseTrustedProxyHopsEnv("1", "test")).toBe(1);
    expect(parseTrustedProxyHopsEnv("0", "test")).toBe(0);
    expect(parseTrustedProxyHopsEnv("42", "test")).toBe(42);
  });

  test("hex/exponent/negative notation throws instead of silently coercing", () => {
    expect(() => parseTrustedProxyHopsEnv("0x10", "test")).toThrow(/non-negative integer/);
    expect(() => parseTrustedProxyHopsEnv("1e3", "test")).toThrow(/non-negative integer/);
    expect(() => parseTrustedProxyHopsEnv("-1", "test")).toThrow(/non-negative integer/);
  });

  test("error message carries the context prefix and the raw value", () => {
    expect(() => parseTrustedProxyHopsEnv("x", "runProdApp")).toThrow(
      'runProdApp: KUMIKO_TRUSTED_PROXY_HOPS must be a non-negative integer, got "x".',
    );
  });
});
