import { describe, expect, it } from "bun:test";
import {
  buildDefaultCsp,
  resolveSecurityHeaders,
  withSecurityHeaders,
} from "../security-headers.ts";

const okHandler = (_req: Request) => new Response("ok");
const req = new Request("http://localhost/");

describe("resolveSecurityHeaders", () => {
  it("returns the four defaults plus the default csp when unconfigured", () => {
    const headers = new Map(resolveSecurityHeaders(undefined));
    expect(headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("content-security-policy")).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
  });

  it("adds the build's script hashes to script-src only", () => {
    const hash = `sha256-${"A".repeat(43)}=`;
    const csp = new Map(resolveSecurityHeaders(undefined, [hash])).get("content-security-policy");
    expect(csp).toContain(`script-src 'self' '${hash}';`);
    expect(csp?.split(hash)).toHaveLength(2);
  });

  it("omits the csp header for csp: false", () => {
    const headers = new Map(resolveSecurityHeaders({ csp: false }));
    expect(headers.has("content-security-policy")).toBe(false);
    expect(headers.has("x-frame-options")).toBe(true);
  });

  it("replaces the default for a csp string and ignores hashes", () => {
    const headers = new Map(resolveSecurityHeaders({ csp: "default-src 'none'" }, ["sha256-x"]));
    expect(headers.get("content-security-policy")).toBe("default-src 'none'");
  });

  it("extends existing directives and adds new ones for csp.extend", () => {
    const csp = buildDefaultCsp([], {
      "connect-src": ["https://api.stripe.com", "'self'"],
      "frame-src": ["https://js.stripe.com"],
      "frame-ancestors": ["https://partner.example"],
    });
    expect(csp).toContain("connect-src 'self' https://api.stripe.com;");
    expect(csp).toContain("frame-src https://js.stripe.com");
    expect(csp).toContain("frame-ancestors https://partner.example;");
    expect(csp).not.toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("rejects csp.extend values that could open a new directive", () => {
    expect(() => buildDefaultCsp([], { "connect-src": ["https://a.test; script-src *"] })).toThrow(
      /single token/,
    );
    expect(() => buildDefaultCsp([], { "connect-src": ["a,b"] })).toThrow(/single token/);
    expect(() => buildDefaultCsp([], { "script-src *; x": ["a"] })).toThrow(/invalid directive/);
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
