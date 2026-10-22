import { describe, expect, test } from "bun:test";
import { RateLimitError } from "@cosmicdrift/kumiko-framework/errors";
import type { PageHeadSystemQuery } from "@cosmicdrift/kumiko-renderer/headless/apex";
import { HostRoutingQueries } from "../constants.ts";
import { createHostDispatch } from "../dispatch.ts";
import { normalizeHostname } from "../host.ts";
import type { HostRoutingOptions } from "../options.ts";

const KNOWN_KEYS = new Set(["acme", "globex", "initech"]);

function keyLookup(known: ReadonlySet<string> = KNOWN_KEYS) {
  const calls: string[] = [];
  const systemQuery: PageHeadSystemQuery = async (type, payload) => {
    expect(type).toBe(HostRoutingQueries.tenantKeyExists);
    const key =
      typeof payload === "object" && payload !== null && "key" in payload ? payload.key : undefined;
    if (typeof key !== "string") throw new Error("payload without key");
    calls.push(key);
    return { exists: known.has(key) };
  };
  return { systemQuery, calls };
}

const TENANT_CSP = "default-src 'self'; frame-ancestors 'none'";

const hostMode: HostRoutingOptions = {
  tenantBy: "host",
  baseDomain: "example.test",
  apex: { file: "index.html", localeFiles: { en: "en/index.html" } },
  tenant: { file: "tenant.html", csp: TENANT_CSP },
  unknownTenant: { file: "unknown-tenant.html" },
  hosts: { "admin.example.test": { file: "admin.html" } },
  locales: { default: "de", prefixed: ["en"] },
};

const pathMode: HostRoutingOptions = {
  tenantBy: "path",
  tenantPathPrefix: "/t",
  baseDomain: "example.test",
  apex: { file: "index.html" },
  tenant: { file: "tenant.html" },
};

function request(host: string, path = "/", search = "") {
  return { host, path, search };
}

describe("createHostDispatch — tenant per host", () => {
  const dispatch = createHostDispatch(hostMode);

  test("three tenant hosts each get the tenant surface after a key lookup", async () => {
    const lookup = keyLookup();
    for (const key of ["acme", "globex", "initech"]) {
      expect(await dispatch(request(`${key}.example.test`, "/app"), lookup)).toEqual({
        kind: "html",
        file: "tenant.html",
        csp: TENANT_CSP,
      });
    }
    expect(lookup.calls).toEqual(["acme", "globex", "initech"]);
  });

  test("an unknown tenant subdomain answers 404 with the unknown-tenant page", async () => {
    expect(await dispatch(request("nope.example.test"), keyLookup())).toEqual({
      kind: "not-found",
      file: "unknown-tenant.html",
    });
  });

  test("a fixed host wins over the subdomain rule and skips the lookup", async () => {
    const lookup = keyLookup();
    expect(await dispatch(request("admin.example.test"), lookup)).toEqual({
      kind: "html",
      file: "admin.html",
    });
    expect(lookup.calls).toEqual([]);
  });

  test("a Host header naming an Object.prototype member is an unknown host", async () => {
    const lookup = keyLookup();
    expect(await dispatch(request("constructor"), lookup)).toEqual({ kind: "not-found" });
    expect(await dispatch(request("hasownproperty"), lookup)).toEqual({ kind: "not-found" });
    expect(lookup.calls).toEqual([]);
  });

  test("apex and www serve the apex file without a CSP override", async () => {
    const lookup = keyLookup();
    expect(await dispatch(request("example.test"), lookup)).toEqual({
      kind: "html",
      file: "index.html",
    });
    expect(await dispatch(request("www.example.test:443"), lookup)).toEqual({
      kind: "html",
      file: "index.html",
    });
    expect(lookup.calls).toEqual([]);
  });

  test("a rate-limited lookup still serves the tenant shell", async () => {
    const systemQuery: PageHeadSystemQuery = async () => {
      throw new RateLimitError({
        bucket: "host-routing",
        limit: 120,
        windowSeconds: 60,
        remaining: 0,
        retryAfterSeconds: 1,
        resetAt: "2026-01-01T00:00:00.000Z",
      });
    };
    expect((await dispatch(request("acme.example.test"), { systemQuery })).kind).toBe("html");
  });

  test("a rate-limited host check in resolver mode still serves the tenant shell", async () => {
    const systemQuery: PageHeadSystemQuery = async () => {
      throw new RateLimitError({
        bucket: "host-routing",
        limit: 120,
        windowSeconds: 60,
        remaining: 0,
        retryAfterSeconds: 1,
        resetAt: "2026-01-01T00:00:00.000Z",
      });
    };
    const resolverDispatch = createHostDispatch({
      ...hostMode,
      tenantBy: async () => null,
    });
    expect((await resolverDispatch(request("shop.example.test"), { systemQuery })).kind).toBe(
      "html",
    );
  });

  test.each([
    ["foreign domain", "evil.test"],
    ["suffix without dot", "acmeexample.test"],
    ["nested subdomain", "a.b.example.test"],
    ["userinfo", "acme@example.test"],
    ["path in host", "example.test/evil"],
    ["IPv6 literal", "[::1]:3000"],
    ["empty", ""],
  ])("%s host fails closed with a bare 404 and no lookup", async (_label, host) => {
    const lookup = keyLookup();
    expect(await dispatch(request(host), lookup)).toEqual({ kind: "not-found" });
    expect(lookup.calls).toEqual([]);
  });
});

describe("createHostDispatch — locale prefix", () => {
  const dispatch = createHostDispatch(hostMode);

  test("the default-locale prefix redirects 301 to the unprefixed path, keeping the query", async () => {
    expect(await dispatch(request("example.test", "/de/pricing", "?ref=x"), keyLookup())).toEqual({
      kind: "redirect",
      to: "/pricing?ref=x",
      status: 301,
    });
    expect(await dispatch(request("example.test", "/de"), keyLookup())).toEqual({
      kind: "redirect",
      to: "/",
      status: 301,
    });
  });

  test("a doubled slash after the locale never yields a protocol-relative redirect", async () => {
    for (const path of ["/de//evil.example", "/de/\\evil.example", "/de/\\/evil.example"]) {
      const result = await dispatch(request("example.test", path), keyLookup());
      expect(result).toEqual({ kind: "redirect", to: "/evil.example", status: 301 });
    }
  });

  test("a prefixed locale serves its locale file, other paths the default file", async () => {
    expect(await dispatch(request("example.test", "/en/pricing"), keyLookup())).toEqual({
      kind: "html",
      file: "en/index.html",
    });
    expect(await dispatch(request("example.test", "/pricing"), keyLookup())).toEqual({
      kind: "html",
      file: "index.html",
    });
  });
});

describe("createHostDispatch — tenant per path", () => {
  const dispatch = createHostDispatch(pathMode);

  test("three tenant paths each get the tenant surface", async () => {
    const lookup = keyLookup();
    for (const key of ["acme", "globex", "initech"]) {
      expect(await dispatch(request("example.test", `/t/${key}/settings`), lookup)).toEqual({
        kind: "html",
        file: "tenant.html",
      });
    }
    expect(lookup.calls).toEqual(["acme", "globex", "initech"]);
  });

  test("the bare prefix serves the tenant shell without a lookup", async () => {
    const lookup = keyLookup();
    expect((await dispatch(request("example.test", "/t"), lookup)).kind).toBe("html");
    expect((await dispatch(request("example.test", "/t/"), lookup)).kind).toBe("html");
    expect(lookup.calls).toEqual([]);
  });

  test("an unknown or malformed key answers a bare 404", async () => {
    const lookup = keyLookup();
    for (const path of ["/t/nope", "/t/Not_A_Key", "/t/a%20b", `/t/${"k".repeat(51)}`]) {
      expect(await dispatch(request("example.test", path), lookup)).toEqual({ kind: "not-found" });
    }
    // Path keys follow the tenant feature's own rule, not the DNS-label rule.
    expect(lookup.calls).toEqual(["nope", "Not_A_Key"]);
  });

  test("a path that only shares the prefix text is an apex page", async () => {
    expect(await dispatch(request("example.test", "/tools"), keyLookup())).toEqual({
      kind: "html",
      file: "index.html",
    });
  });

  test("subdomains are not tenants in path mode", async () => {
    expect(await dispatch(request("acme.example.test", "/"), keyLookup())).toEqual({
      kind: "not-found",
    });
  });
});

describe("createHostDispatch — option validation", () => {
  test.each<[string, HostRoutingOptions]>([
    ["baseDomain with scheme", { ...pathMode, baseDomain: "https://example.test" }],
    ["prefix without slash", { ...pathMode, tenantPathPrefix: "t" }],
    ["prefix with trailing slash", { ...pathMode, tenantPathPrefix: "/t/" }],
    ["default locale also prefixed", { ...hostMode, locales: { default: "de", prefixed: ["de"] } }],
    ["fixed host with port", { ...hostMode, hosts: { "admin.example.test:3000": { file: "a" } } }],
  ])("rejects %s", (_label, options) => {
    expect(() => createHostDispatch(options)).toThrow();
  });
});

describe("normalizeHostname", () => {
  test("lowercases, strips port and trailing dot", () => {
    expect(normalizeHostname("ACME.Example.Test.:8080")).toBe("acme.example.test");
  });

  test("rejects anything that is not a plain DNS name", () => {
    expect(normalizeHostname("acme.example.test, evil.test")).toBeNull();
    expect(normalizeHostname("acme.example.test:99999999")).toBeNull();
  });
});

describe("createHostDispatch — redirects", () => {
  const dispatch = createHostDispatch({
    ...hostMode,
    redirects: [
      { from: "/legacy", to: "/new", host: "admin.example.test" },
      { from: "/moved", to: "https://other.example.test/landing", status: 302 },
    ],
  });

  test("a rule on a host redirects with the remainder and query appended", async () => {
    expect(
      await dispatch(request("admin.example.test", "/legacy/acme/x", "?a=1"), keyLookup()),
    ).toEqual({ kind: "redirect", to: "/new/acme/x?a=1", status: 301 });
  });

  test("the rule does not apply on other hosts or to similar prefixes", async () => {
    expect((await dispatch(request("example.test", "/legacy"), keyLookup())).kind).toBe("html");
    expect((await dispatch(request("admin.example.test", "/legacy-other"), keyLookup())).kind).toBe(
      "html",
    );
  });

  test("absolute https targets keep their fixed origin", async () => {
    expect(await dispatch(request("example.test", "/moved//evil.test"), keyLookup())).toEqual({
      kind: "redirect",
      to: "https://other.example.test/landing//evil.test",
      status: 302,
    });
  });

  test("a relative target never becomes protocol-relative", async () => {
    const root = createHostDispatch({ ...hostMode, redirects: [{ from: "/old", to: "/" }] });
    expect(await root(request("example.test", "/old//evil.test"), keyLookup())).toEqual({
      kind: "redirect",
      to: "/evil.test",
      status: 301,
    });
  });

  test("a redirect from an /api path fails at boot", () => {
    for (const from of ["/api", "/api/query"]) {
      expect(() => createHostDispatch({ ...hostMode, redirects: [{ from, to: "/a" }] })).toThrow(
        "redirect from must not be an /api path",
      );
    }
  });

  test("invalid redirect targets fail at boot", () => {
    for (const to of ["//evil.test", "http://evil.test", "/a?x=1", "javascript:alert(1)"]) {
      expect(() => createHostDispatch({ ...hostMode, redirects: [{ from: "/a", to }] })).toThrow(
        "redirect to",
      );
    }
  });
});

describe("createHostDispatch — apex path tenants in host mode", () => {
  const dispatch = createHostDispatch({ ...hostMode, tenantPathPrefix: "/a" });

  test("the apex serves tenants under the prefix next to subdomain tenants", async () => {
    const lookup = keyLookup();
    expect(await dispatch(request("example.test", "/a/acme/home"), lookup)).toEqual({
      kind: "html",
      file: "tenant.html",
      csp: TENANT_CSP,
    });
    expect(await dispatch(request("globex.example.test", "/"), lookup)).toEqual({
      kind: "html",
      file: "tenant.html",
      csp: TENANT_CSP,
    });
    expect((await dispatch(request("example.test", "/a/nope"), lookup)).kind).toBe("not-found");
    expect((await dispatch(request("example.test", "/pricing"), lookup)).kind).toBe("html");
  });
});

describe("host-routing option validation", () => {
  test("an allowlist key must be an apex hostname", () => {
    expect(() =>
      createHostDispatch({ ...hostMode, apexAnonymousQueryAllowlist: { "other.test": [] } }),
    ).toThrow("apexAnonymousQueryAllowlist");
  });

  test("an allowlist is rejected in path mode, where X-Tenant would bypass it", () => {
    expect(() =>
      createHostDispatch({
        tenantBy: "path",
        tenantPathPrefix: "/app",
        baseDomain: "example.test",
        apex: { file: "index.html" },
        tenant: { file: "tenant.html" },
        apexAnonymousQueryAllowlist: { "example.test": [] },
      }),
    ).toThrow('cannot be used with tenantBy "path"');
  });
});
