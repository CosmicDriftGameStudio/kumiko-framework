import { describe, expect, it } from "bun:test";
import { resolveSecurityHeaders, withSecurityHeaders } from "../security-headers";

const okHandler = (_req: Request) => new Response("ok");
const req = new Request("http://localhost/");

describe("resolveSecurityHeaders", () => {
  it("returns the four defaults without csp when unconfigured", () => {
    const headers = new Map(resolveSecurityHeaders(undefined));
    expect(headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.has("content-security-policy")).toBe(false);
  });

  it("returns nothing when disabled", () => {
    expect(resolveSecurityHeaders(false)).toEqual([]);
  });

  it("applies per-header overrides and opt-outs", () => {
    const headers = new Map(
      resolveSecurityHeaders({
        hsts: "max-age=60",
        frameOptions: false,
        referrerPolicy: "no-referrer",
        csp: "default-src 'self'",
      }),
    );
    expect(headers.get("strict-transport-security")).toBe("max-age=60");
    expect(headers.has("x-frame-options")).toBe(false);
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("content-security-policy")).toBe("default-src 'self'");
  });
});

describe("withSecurityHeaders", () => {
  it("sets defaults on every response", async () => {
    const res = await withSecurityHeaders(okHandler, undefined)(req);
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(await res.text()).toBe("ok");
  });

  it("returns the handler unwrapped when disabled", () => {
    expect(withSecurityHeaders(okHandler, false)).toBe(okHandler);
  });

  it("never overrides a header the response already set", async () => {
    const handler = (_req: Request) =>
      new Response("ok", {
        headers: {
          "content-security-policy": "default-src 'none'",
          "x-frame-options": "SAMEORIGIN",
        },
      });
    const res = await withSecurityHeaders(handler, { csp: "default-src 'self'" })(req);
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("re-wraps responses with immutable headers", async () => {
    const immutable = new Response("ok", { status: 201, statusText: "Created" });
    Object.defineProperty(immutable, "headers", {
      value: new Proxy(immutable.headers, {
        get(target, prop) {
          if (prop === "set") {
            return () => {
              throw new TypeError("immutable");
            };
          }
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    });
    const res = await withSecurityHeaders(() => immutable, undefined)(req);
    expect(res.status).toBe(201);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("ok");
  });
});
