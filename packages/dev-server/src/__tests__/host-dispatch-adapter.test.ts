import { describe, expect, test } from "bun:test";
import { createHostDispatch } from "@cosmicdrift/kumiko-bundled-features/host-routing";
import type { PageHeadSystemQuery } from "@cosmicdrift/kumiko-headless/apex";
import type { HostDispatchFn } from "@cosmicdrift/kumiko-server-runtime/run-prod-app";
import { toDevHostDispatch } from "../host-dispatch-adapter.js";

const systemQuery: PageHeadSystemQuery = async (_type, payload) => ({
  exists:
    typeof payload === "object" && payload !== null && "key" in payload && payload.key === "acme",
});

const dispatch = createHostDispatch({
  tenantBy: "host",
  baseDomain: "example.test",
  apex: { file: "index.html" },
  tenant: { file: "tenant.html", csp: "default-src 'self'" },
  unknownTenant: { file: "unknown-tenant.html" },
  locales: { default: "de", prefixed: ["en"] },
});

// Compile-time pin: the bundled-features dispatch plugs into runProdApp's
// hostDispatch unchanged. Breaks typecheck if either side drifts.
const prodHostDispatch: HostDispatchFn = dispatch;

const devDispatch = toDevHostDispatch(dispatch, {
  entries: { "tenant.html": "tenant" },
  staticDir: "dist/static",
});

function devRequest(host: string, path: string): Request {
  return new Request(`http://localhost:3000${path}`, { headers: { host } });
}

describe("toDevHostDispatch", () => {
  test("prod gets the per-surface CSP that dev drops", async () => {
    expect(
      await prodHostDispatch({ host: "acme.example.test", path: "/", search: "" }, { systemQuery }),
    ).toEqual({ kind: "html", file: "tenant.html", csp: "default-src 'self'" });
  });

  test("a mapped prod file becomes the dev client entry", async () => {
    expect(await devDispatch(devRequest("acme.example.test:3000", "/"), { systemQuery })).toEqual({
      kind: "html",
      entryName: "tenant",
    });
  });

  test("an unmapped prod file is served verbatim from staticDir", async () => {
    expect(await devDispatch(devRequest("example.test", "/"), { systemQuery })).toEqual({
      kind: "static-html",
      file: "dist/static/index.html",
    });
  });

  test("an unknown tenant keeps the 404 page", async () => {
    expect(await devDispatch(devRequest("nope.example.test", "/"), { systemQuery })).toEqual({
      kind: "not-found",
      file: "dist/static/unknown-tenant.html",
    });
  });

  test("redirects pass through with the query string", async () => {
    expect(
      await devDispatch(devRequest("example.test", "/de/pricing?ref=x"), { systemQuery }),
    ).toEqual({ kind: "redirect", to: "/pricing?ref=x", status: 301 });
  });
});
