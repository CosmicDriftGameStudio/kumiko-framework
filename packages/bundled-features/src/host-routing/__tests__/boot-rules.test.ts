import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createHostDispatch } from "../dispatch.ts";
import type { HostRoutingOptions } from "../options.ts";

const base: HostRoutingOptions = {
  baseDomain: "example.com",
  apex: { file: "index.html" },
  tenant: { file: "app.html" },
  tenantBy: "host",
};

describe("host-routing boot rules", () => {
  test("a redirect from outside /api path form violates invalid-redirect", () => {
    const error = bootRuleViolationOf(() =>
      createHostDispatch({ ...base, redirects: [{ from: "/api/x", to: "/y" }] }),
    );
    expect(error.rule.id).toBe("host-routing/invalid-redirect");
    expect(error.message).toContain("redirect from must not be an /api path");
  });

  test("apexAnonymousQueryAllowlist with tenantBy path violates invalid-apex-anonymous-query-allowlist", () => {
    const error = bootRuleViolationOf(() =>
      createHostDispatch({
        ...base,
        tenantBy: "path",
        tenantPathPrefix: "/app",
        apexAnonymousQueryAllowlist: { "example.com": [] },
      }),
    );
    expect(error.rule.id).toBe("host-routing/invalid-apex-anonymous-query-allowlist");
    expect(error.message).toContain('cannot be used with tenantBy "path"');
  });

  test("an uppercase baseDomain violates invalid-domain-or-prefix", () => {
    const error = bootRuleViolationOf(() =>
      createHostDispatch({ ...base, baseDomain: "Example.COM" }),
    );
    expect(error.rule.id).toBe("host-routing/invalid-domain-or-prefix");
    expect(error.message).toContain("baseDomain must be a lowercase hostname");
  });

  test("a default locale inside prefixed violates invalid-locales", () => {
    const error = bootRuleViolationOf(() =>
      createHostDispatch({ ...base, locales: { default: "de", prefixed: ["de", "en"] } }),
    );
    expect(error.rule.id).toBe("host-routing/invalid-locales");
    expect(error.message).toContain("must not be in prefixed");
  });
});
