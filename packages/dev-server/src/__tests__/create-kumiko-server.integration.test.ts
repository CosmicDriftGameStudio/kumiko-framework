import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExtraRouteRejection,
  NO_ROUTE_MATCH_HEADER_NAME,
  signatureRoute,
} from "@cosmicdrift/kumiko-framework/api";
import { asRawClient, rowLevelSecurityModeOf } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getSetCookieValue, readSseFrames } from "@cosmicdrift/kumiko-testing/helpers";
import {
  type CreateKumikoServerOptions,
  createKumikoServer,
  type DevHostDispatchResult,
  type KumikoServerHandle,
} from "../create-kumiko-server.ts";
import { PROD_BUNDLES_ENV } from "../create-kumiko-server-client-bundles.ts";
import { STYLESHEET_WATCH_ENV } from "../create-kumiko-server-stylesheet.ts";
import { probeFeature } from "./create-kumiko-server-probe.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;

// Integration test: boots createKumikoServer with real Postgres, Redis, and the
// Kumiko pipeline. It drives the fetch handler directly rather than through
// Bun.serve and a socket because Vitest runs under Node. Bun would produce the
// same responses; routing is runtime-neutral.

let handle: KumikoServerHandle | undefined;

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = undefined;
  }
});

async function boot(): Promise<KumikoServerHandle> {
  handle = await createKumikoServer({
    features: [probeFeature],
    port: 0,
    installSignalHandlers: false,
  });
  return handle;
}

describe("createKumikoServer", () => {
  test("bootet den Kumiko-Stack + legt die Feature-Tables an", async () => {
    const h = await boot();
    const rows = await asRawClient(h.stack.db).unsafe(
      `SELECT to_regclass('public.kumiko_server_probe') IS NOT NULL AS "exists"`,
    );
    expect((rows as Array<Record<string, unknown>>)[0]?.["exists"]).toBe(true);
  });

  test("without a rowLevelSecurity option the server runs its enforced pool as a non-superuser role", async () => {
    const h = await boot();
    expect(rowLevelSecurityModeOf(h.stack.unscopedDb)).toBe("on");
    const rows = await asRawClient(h.stack.unscopedDb).unsafe(
      "SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect((rows as Array<Record<string, unknown>>)[0]).toEqual({
      role: "kumiko_app",
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  test("GET / → HTML + kumiko_auth/kumiko_csrf Set-Cookie", async () => {
    const h = await boot();
    const res = await h.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/kumiko_auth=/);
    expect(setCookie).toMatch(/kumiko_csrf=/);
    const body = await res.text();
    expect(body).toMatch(/<div id="root">/);
    expect(body).toMatch(/EventSource\("\/_reload"\)/);
    // As a classic script the bundle's top-level declarations become window
    // properties: a dependency exporting `function history()`
    // (prosemirror-history, via tiptap) then replaces window.history and every
    // pushState throws. Prod has always emitted the module form.
    expect(body).toMatch(/<script type="module" src="\/client\.js"><\/script>/);
  });

  test("GET /client.js → 404 wenn clientEntry fehlt (Route nicht registriert)", async () => {
    // Before the multi-entry refactor, this returned 200 with an empty body as
    // quirky backwards compatibility. With the multi-entry engine, /client.js is
    // registered only when an entry exists: no entries means no bundle asset path,
    // so 404 is correct.
    const h = await boot();
    const res = await h.fetch(new Request("http://localhost/client.js"));
    expect(res.status).toBe(404);
  });

  test("Single-Entry: clientEntry='client.tsx' liefert Bundle unter /client.js", async () => {
    // Backwards-compatibility smoke test: existing samples (designer,
    // ui-walkthrough, beammycar, …) use clientEntry, so normalization must derive
    // `/client.js` as the asset path. _buildBundle injects a stub so the body can
    // be checked deterministically without running Bun.build under Node.
    const tmpFile = mkdtempSync(join(tmpdir(), "kumiko-single-it-"));
    const entry = join(tmpFile, "client.tsx");
    writeFileSync(entry, "// noop");
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
        clientEntry: entry,
        _buildBundle: async () => ({ js: "// SINGLE-ENTRY-STUB", map: "" }),
      });
      const res = await handle.fetch(new Request("http://localhost/client.js"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/javascript/);
      expect(await res.text()).toBe("// SINGLE-ENTRY-STUB");
    } finally {
      rmSync(tmpFile, { recursive: true, force: true });
    }
  });

  test("GET /client.js.map → 404 wenn kein Sourcemap vorhanden", async () => {
    const h = await boot();
    const res = await h.fetch(new Request("http://localhost/client.js.map"));
    expect(res.status).toBe(404);
  });

  test("GET /_reload → text/event-stream mit connected-Komment", async () => {
    const h = await boot();
    const res = await h.fetch(new Request("http://localhost/_reload"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toMatch(/connected/);
    await reader.cancel();
  });

  test("unbekannter Pfad → forwarded an den Hono-Stack", async () => {
    const h = await boot();
    // /api/ghost is not registered, so Hono returns 404. The response must come
    // from the stack rather than the dev-server layer; checking that it is neither
    // HTML nor an event stream distinguishes the two layers.
    const res = await h.fetch(new Request("http://localhost/api/ghost"));
    expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/html/);
    expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/event-stream/);
  });

  test("Server-Instanz unter Bun gesetzt, unter Node undefined", async () => {
    const h = await boot();
    if (typeof Bun !== "undefined") {
      expect(h.server).toBeDefined();
    } else {
      expect(h.server).toBeUndefined();
    }
  });
});

// Multi-entry mode exercises clientEntries and hostDispatch (a discriminated
// union). Bun.build is stubbed through _buildBundle; this fully exercises the
// runtime-neutral HTML dispatch by host and bundle routing by asset path. Real
// bundle production is covered by the `kumiko-build CLI` suite
// (build-prod-bundle.integration.ts).
describe("createKumikoServer (Multi-Entry)", () => {
  let tmpDir = "";

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  async function bootMultiEntry(): Promise<KumikoServerHandle> {
    tmpDir = mkdtempSync(join(tmpdir(), "kumiko-multi-it-"));
    const publicEntry = join(tmpDir, "client-public.tsx");
    const adminEntry = join(tmpDir, "client-admin.tsx");
    const publicHtml = join(tmpDir, "index.html");
    const adminHtml = join(tmpDir, "admin.html");
    writeFileSync(publicEntry, "// public");
    writeFileSync(adminEntry, "// admin");
    writeFileSync(
      publicHtml,
      `<!doctype html><html><body><div id="root"></div><script src="/client-public.js"></script>PUBLIC-HTML</body></html>`,
    );
    writeFileSync(
      adminHtml,
      `<!doctype html><html><body><div id="root"></div><script src="/client-admin.js"></script>ADMIN-HTML</body></html>`,
    );

    return createKumikoServer({
      features: [probeFeature],
      port: 0,
      installSignalHandlers: false,
      clientEntries: [
        { name: "public", sourceFile: publicEntry, htmlPath: publicHtml },
        { name: "admin", sourceFile: adminEntry, htmlPath: adminHtml },
      ],
      // The stubbed bundle includes the entry name so the test can verify that
      // /client-public.js and /client-admin.js differ. Real Bun.build would produce
      // differently hashed bundles; deterministic markers simulate that distinction.
      _buildBundle: async (sourceFile) => {
        if (sourceFile === publicEntry) {
          return { js: "// PUBLIC-BUNDLE", map: "" };
        }
        if (sourceFile === adminEntry) {
          return { js: "// ADMIN-BUNDLE", map: "" };
        }
        throw new Error(`unexpected entry: ${sourceFile}`);
      },
      hostDispatch: (req) => {
        const host = (req.headers.get("host") ?? "").split(":")[0]?.toLowerCase() ?? "";
        if (host === "apex.test") return { kind: "not-found" };
        if (host === "old.test") return { kind: "redirect", to: "https://new.test/" };
        if (host.startsWith("admin.")) {
          return { kind: "html", entryName: "admin" };
        }
        return { kind: "html", entryName: "public" };
      },
    });
  }

  test("HTML-Dispatch: admin-Host bekommt admin.html, sonst index.html", async () => {
    handle = await bootMultiEntry();

    const publicRes = await handle.fetch(
      new Request("http://status.localhost/", { headers: { host: "status.localhost" } }),
    );
    const publicBody = await publicRes.text();
    expect(publicBody).toMatch(/PUBLIC-HTML/);
    expect(publicBody).not.toMatch(/ADMIN-HTML/);

    const adminRes = await handle.fetch(
      new Request("http://admin.localhost/", { headers: { host: "admin.localhost" } }),
    );
    const adminBody = await adminRes.text();
    expect(adminBody).toMatch(/ADMIN-HTML/);
    expect(adminBody).not.toMatch(/PUBLIC-HTML/);
  });

  test("Bundle-Routing: /client-public.js ≠ /client-admin.js", async () => {
    handle = await bootMultiEntry();

    const publicJs = await handle.fetch(new Request("http://status.localhost/client-public.js"));
    expect(publicJs.status).toBe(200);
    expect(publicJs.headers.get("content-type")).toMatch(/application\/javascript/);
    expect(await publicJs.text()).toBe("// PUBLIC-BUNDLE");

    const adminJs = await handle.fetch(new Request("http://admin.localhost/client-admin.js"));
    expect(adminJs.status).toBe(200);
    expect(await adminJs.text()).toBe("// ADMIN-BUNDLE");

    // Cross-routing does not exist: /client.js, the single-entry path, is not a
    // registered asset path in multi-entry mode.
    const noFallback = await handle.fetch(new Request("http://localhost/client.js"));
    expect(noFallback.status).toBe(404);
  });

  test("HTML never carries the schema; GET /api/schema needs the auto-minted cookie (kumiko-framework#3314)", async () => {
    handle = await bootMultiEntry();

    const publicRes = await handle.fetch(
      new Request("http://status.localhost/", { headers: { host: "status.localhost" } }),
    );
    expect(await publicRes.text()).not.toMatch(/__KUMIKO_SCHEMA__/);

    const adminRes = await handle.fetch(
      new Request("http://admin.localhost/", { headers: { host: "admin.localhost" } }),
    );
    expect(await adminRes.text()).not.toMatch(/__KUMIKO_SCHEMA__/);

    const authCookie = getSetCookieValue(adminRes, "kumiko_auth");
    expect(authCookie).toBeDefined();

    const unauthenticated = await handle.fetch(new Request("http://admin.localhost/api/schema"));
    expect(unauthenticated.status).toBe(401);

    const authenticatedRes = await handle.fetch(
      new Request("http://admin.localhost/api/schema", {
        headers: { cookie: `kumiko_auth=${authCookie}` },
      }),
    );
    expect(authenticatedRes.status).toBe(200);
    const schema = await authenticatedRes.json();
    // Guards against an empty features array making the `.some(...)`
    // assertion below vacuously false.
    expect(schema.features.length).toBeGreaterThan(0);

    // setupTestStack always wires an in-memory SearchAdapter
    // (test-stack.ts), so the dev-server call site's
    // `searchAdapterMissing: !stack.context.searchAdapter` must read false —
    // proving the flag actually flows from stack.context through to the
    // schema served by GET /api/schema.
    const anyFeatureMissingAdapter = schema.features.some(
      (f: { searchAdapterMissing?: boolean }) => f.searchAdapterMissing === true,
    );
    expect(anyFeatureMissingAdapter).toBe(false);
  });

  test("hostDispatch redirect: liefert 302 mit Location-Header", async () => {
    handle = await bootMultiEntry();

    const res = await handle.fetch(
      new Request("http://old.test/", { headers: { host: "old.test" } }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://new.test/");
  });

  test("hostDispatch not-found: liefert 404", async () => {
    handle = await bootMultiEntry();

    const res = await handle.fetch(
      new Request("http://apex.test/", { headers: { host: "apex.test" } }),
    );
    expect(res.status).toBe(404);
  });

  describe("hostDispatch not-found with a custom page", () => {
    async function bootNotFound(result: () => DevHostDispatchResult) {
      tmpDir = mkdtempSync(join(tmpdir(), "kumiko-multi-it-"));
      const publicEntry = join(tmpDir, "client-public.tsx");
      writeFileSync(publicEntry, "// public");
      const publicHtml = join(tmpDir, "index.html");
      writeFileSync(publicHtml, "<!doctype html><html><body>PUBLIC-HTML</body></html>");
      writeFileSync(join(tmpDir, "gone.html"), "<html><body>unknown tenant</body></html>");
      return createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
        clientEntries: [{ name: "public", sourceFile: publicEntry, htmlPath: publicHtml }],
        _buildBundle: async () => ({ js: "// PUBLIC-BUNDLE", map: "" }),
        hostDispatch: result,
      });
    }

    test("file → 404 with that page as html", async () => {
      handle = await bootNotFound(() => ({ kind: "not-found", file: join(tmpDir, "gone.html") }));
      const res = await handle.fetch(new Request("http://localhost/"));
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("unknown tenant");
    });

    test("entryName → 404 with that entry's shell", async () => {
      handle = await bootNotFound(() => ({ kind: "not-found", entryName: "public" }));
      const res = await handle.fetch(new Request("http://localhost/"));
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("PUBLIC-HTML");
    });

    test("no fields → plain Not Found", async () => {
      handle = await bootNotFound(() => ({ kind: "not-found" }));
      const res = await handle.fetch(new Request("http://localhost/"));
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
    });

    test("missing file → 500", async () => {
      handle = await bootNotFound(() => ({ kind: "not-found", file: "/nonexistent/page.html" }));
      const res = await handle.fetch(new Request("http://localhost/"));
      expect(res.status).toBe(500);
      expect(await res.text()).toContain("hostDispatch: file not found: /nonexistent/page.html");
    });

    test("static-html → 200 with the file verbatim: no reload snippet, no minted cookies", async () => {
      handle = await bootNotFound(() => ({ kind: "static-html", file: join(tmpDir, "gone.html") }));
      const res = await handle.fetch(new Request("http://localhost/"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(await res.text()).toBe("<html><body>unknown tenant</body></html>");
    });
  });

  test("hostDispatch: async fn erhält deps.systemQuery, 'not-found' → 404 (kumiko-framework#3050 dev-Pendant)", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kumiko-multi-it-"));
    const publicEntry = join(tmpDir, "client-public.tsx");
    writeFileSync(publicEntry, "// public");
    let systemQueryPonged = false;

    handle = await createKumikoServer({
      features: [probeFeature],
      port: 0,
      installSignalHandlers: false,
      clientEntries: [{ name: "public", sourceFile: publicEntry }],
      _buildBundle: async () => ({ js: "// PUBLIC-BUNDLE", map: "" }),
      hostDispatch: async (_req, deps) => {
        const result = await deps.systemQuery("dev-server-probe:query:ping", {}, TENANT_ID);
        systemQueryPonged = (result as { pong: boolean }).pong === true; // @cast-boundary engine-payload
        return { kind: "not-found" };
      },
    });

    const res = await handle.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(404);
    expect(systemQueryPonged).toBe(true);
  });
});

// 252/2: the dev path shares extra-routes-deps.ts with runProdApp —
// here the analogous proof against createKumikoServer, with `wire` for the
// registry/dispatchSystemWrite check and an entry:"signature" route for
// the webhook dispatch.
describe("createKumikoServer extraRoutes / wire deps", () => {
  test("wire: dispatchSystemWrite schreibt als SystemAdmin des Ziel-Tenants, registry verfügbar", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000042";
    let registryHasProbe = false;
    handle = await createKumikoServer({
      features: [probeFeature],
      port: 0,
      installSignalHandlers: false,
      extraRoutes: [
        signatureRoute({
          method: "POST",
          path: "/webhook-probe",
          entry: "signature",
          verify: async (req) => {
            if (req.headers["x-probe-signature"] !== "test-secret") {
              throw new ExtraRouteRejection(401, { error: "bad-signature" });
            }
          },
          handler: async (c, _verified, deps) => {
            const result = await deps.dispatchSystemWrite({
              handlerQn: "dev-server-probe:write:probe-write",
              payload: { note: "from-webhook" },
              tenantId: tenantId as import("@cosmicdrift/kumiko-framework/engine").TenantId,
            });
            return c.json(result);
          },
        }),
      ],
      wire: (deps) => {
        registryHasProbe = deps.registry.features.has("dev-server-probe");
      },
    });

    expect(registryHasProbe).toBe(true);

    const res = await handle.fetch(
      new Request("http://test/webhook-probe", {
        method: "POST",
        headers: { "x-probe-signature": "test-secret" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      isSuccess: boolean;
      data?: { tenantSeen: string; roles: string[] };
    };
    expect(body.isSuccess).toBe(true);
    expect(body.data?.tenantSeen).toBe(tenantId);
    expect(body.data?.roles).toContain("SystemAdmin");
  });
});

// extraRoutes must be registered BEFORE onAfterSetup
// dispatches through stack.http — Hono builds its matcher on first dispatch,
// and any route registered after that throws. Pins the ordering.
describe("createKumikoServer — extraRoutes vs. onAfterSetup ordering", () => {
  test("an extraRoutes route stays reachable after onAfterSetup dispatches via stack.http", async () => {
    handle = await createKumikoServer({
      features: [probeFeature],
      port: 0,
      installSignalHandlers: false,
      extraRoutes: [
        {
          method: "GET",
          path: "/probe",
          entry: "anonymous",
          handler: (c) => c.json({ ok: true }),
        },
      ],
      onAfterSetup: async (stack) => {
        await stack.http.writeOk(
          "dev-server-probe:write:probe-write",
          { note: "onAfterSetup" },
          TestUsers.systemAdmin,
        );
      },
    });

    const res = await handle.fetch(new Request("http://test/probe"));
    expect(res.status).toBe(200);
  });
});

describe("createKumikoServer — stylesheet tailwind failure (graceful)", () => {
  test("missing stylesheet entry boots without CSS — GET /styles.css → 404", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kumiko-css-fail-"));
    const entry = join(tmpDir, "client.tsx");
    writeFileSync(entry, "export const x = 1;\n");
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
        clientEntry: entry,
        stylesheet: join(tmpDir, "does-not-exist.css"),
        _buildBundle: async () => ({ js: "// stub", map: "" }),
      });
      const cssRes = await handle.fetch(new Request("http://localhost/styles.css"));
      expect(cssRes.status).toBe(404);
      expect(await cssRes.text()).toBe("no stylesheet");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("createKumikoServer — stylesheet watch disabled via env", () => {
  test("KUMIKO_DEV_STYLESHEET_WATCH=0 serves the built CSS and never spawns a --watch process", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kumiko-css-no-watch-"));
    const entryCss = join(tmpDir, "styles.css");
    // Plain CSS, no `@import "tailwindcss"` — the marker property survives
    // the Tailwind CLI/lightningcss pass unchanged, unlike a color value
    // which lightningcss may renormalize.
    writeFileSync(entryCss, ".kumiko-probe { --probe-marker: 42; }\n");
    const previousWatchEnv = process.env[STYLESHEET_WATCH_ENV];
    process.env[STYLESHEET_WATCH_ENV] = "0";
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
        stylesheet: entryCss,
      });

      const cssRes = await handle.fetch(new Request("http://localhost/styles.css"));
      expect(cssRes.status).toBe(200);
      const css = await cssRes.text();
      expect(css).toContain("--probe-marker: 42");

      // -ww: unwrapped, full argv — a truncated args column would make the
      // negative assert below pass vacuously. The pid check proves ps
      // actually returned live process rows on this machine/CI runner.
      const ps = Bun.spawnSync(["ps", "-A", "-ww", "-o", "pid=,args="]);
      const psOutput = ps.stdout.toString();
      const lines = psOutput.split("\n");
      expect(lines.some((line) => line.includes(String(process.pid)))).toBe(true);
      expect(lines.some((line) => line.includes(entryCss) && line.includes("--watch"))).toBe(false);
    } finally {
      if (previousWatchEnv === undefined) delete process.env[STYLESHEET_WATCH_ENV];
      else process.env[STYLESHEET_WATCH_ENV] = previousWatchEnv;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("createKumikoServer — real Bun.build (buildClient)", () => {
  test("clientEntry without _buildBundle produces a JS bundle via Bun.build", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kumiko-real-build-"));
    const entry = join(tmpDir, "client.tsx");
    // Minimal entry Bun.build can emit — no JSX, no imports.
    writeFileSync(entry, "export const ping = 1;\n");
    // Empty dirs matching a glob — exercises expandWatchPatterns without
    // writing files (avoids process.exit(75) from bare .tsx events).
    mkdirSync(join(tmpDir, "pkg-a"));
    mkdirSync(join(tmpDir, "pkg-b"));
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
        clientEntry: entry,
        stylesheet: false,
        watchDirs: [join(tmpDir, "pkg-*")],
      });
      const res = await handle.fetch(new Request("http://localhost/client.js"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/javascript/);
      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
      expect(body).toMatch(/ping/);

      const mapRes = await handle.fetch(new Request("http://localhost/client.js.map"));
      expect(mapRes.status).toBe(200);
      expect(await mapRes.text()).toMatch(/"sources"/);

      // Stop the watcher before teardown rmSync deletes clientEntry out from
      // under it — a bare "client.tsx" delete event classifies as "restart"
      // (classifyChange only special-cases endsWith("/client.tsx")) and
      // process.exit(75) kills the whole bun test runner mid-suite.
      await handle.stop();
      handle = undefined;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("PROD_BUNDLES_ENV builds a prod-shaped bundle: split chunk served, no sourcemap, NODE_ENV replaced", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kumiko-real-build-prod-"));
    const entry = join(tmpDir, "client.tsx");
    writeFileSync(
      entry,
      `export async function loadLazy() {
  const m = await import("./lazy.ts");
  return m.hello();
}
`,
    );
    writeFileSync(
      join(tmpDir, "lazy.ts"),
      `export function hello() {
  return "env=" + process.env.NODE_ENV;
}
`,
    );
    const previousProdBundles = process.env[PROD_BUNDLES_ENV];
    process.env[PROD_BUNDLES_ENV] = "1";
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
        clientEntry: entry,
        stylesheet: false,
      });
      const res = await handle.fetch(new Request("http://localhost/client.js"));
      expect(res.status).toBe(200);
      const body = await res.text();

      // Only the dynamic import() call points at the lazy chunk — the
      // entry also statically imports a shared async-loader chunk.
      const chunkMatch = body.match(/import\("(?:\.\/)?(chunk-[\w-]+\.js)"\)/);
      expect(chunkMatch).not.toBeNull();
      const normalizedChunkPath = `/${chunkMatch ? (chunkMatch[1] ?? "") : ""}`;

      const chunkRes = await handle.fetch(new Request(`http://localhost${normalizedChunkPath}`));
      expect(chunkRes.status).toBe(200);
      expect(chunkRes.headers.get("content-type")).toMatch(/application\/javascript/);
      const chunkBody = await chunkRes.text();
      expect(chunkBody).toContain("env=production");

      const mapRes = await handle.fetch(new Request("http://localhost/client.js.map"));
      expect(mapRes.status).toBe(404);

      await handle.stop();
      handle = undefined;
    } finally {
      if (previousProdBundles === undefined) delete process.env[PROD_BUNDLES_ENV];
      else process.env[PROD_BUNDLES_ENV] = previousProdBundles;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

function fakeDirectoryWatch(): {
  readonly watchDirectory: NonNullable<CreateKumikoServerOptions["_watchDirectory"]>;
  readonly emit: (filename: string) => void;
} {
  const queued: string[] = [];
  let wake: (() => void) | undefined;
  const watchDirectory: NonNullable<CreateKumikoServerOptions["_watchDirectory"]> = (
    _dir,
    { signal },
  ) => ({
    async *[Symbol.asyncIterator]() {
      while (!signal.aborted) {
        const filename = queued.shift();
        if (filename !== undefined) {
          yield { filename };
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    },
  });
  return {
    watchDirectory,
    emit: (filename) => {
      queued.push(filename);
      wake?.();
    },
  };
}

describe("createKumikoServer — hot-reload broadcast", () => {
  test("file change under web/ rebuilds and broadcasts SSE reload", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kumiko-watch-"));
    const entry = join(tmpDir, "client.tsx");
    const webDir = join(tmpDir, "web");
    mkdirSync(webDir);
    writeFileSync(entry, "export const ping = 1;\n");

    let builds = 0;
    const watchEvents = fakeDirectoryWatch();
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
        clientEntry: entry,
        stylesheet: false,
        _watchDirectory: watchEvents.watchDirectory,
        // Only the entry dir is watched (no extra watchDirs) — a nested
        // web/page.tsx event arrives as "web/page.tsx" → hot-reload.
        // Watching web/ separately would fire bare "page.tsx" → restart
        // → process.exit(75) and kill the test runner.
        _buildBundle: async () => {
          builds += 1;
          return { js: `// build-${builds}`, map: "" };
        },
      });

      const sseRes = await handle.fetch(new Request("http://localhost/_reload"));
      expect(sseRes.status).toBe(200);

      const initialBuilds = builds;
      watchEvents.emit("web/page.tsx");

      // Native fs events are not used: macOS FSEvents starts asynchronously and drops early writes.
      const frames = await readSseFrames(sseRes, { until: (frame) => frame.event === "reload" });
      const reloadedFile = String(JSON.parse(frames.at(-1)?.data ?? "null"));
      expect(reloadedFile).toBe("web/page.tsx");

      expect(builds).toBeGreaterThan(initialBuilds);

      const js = await handle.fetch(new Request("http://localhost/client.js"));
      expect(await js.text()).toMatch(/build-/);

      // Abort watchers before teardown rmSync can fire a restart event.
      await handle.stop();
      handle = undefined;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("a failing rebuild keeps serving the last good bundle and broadcasts no reload", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kumiko-watch-"));
    const entry = join(tmpDir, "client.tsx");
    writeFileSync(entry, "export const ping = 1;\n");

    let builds = 0;
    let failNextBuild = false;
    let signalFailedBuild: (() => void) | undefined;
    const failedBuildSeen = new Promise<void>((resolve) => {
      signalFailedBuild = resolve;
    });
    const watchEvents = fakeDirectoryWatch();
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
        clientEntry: entry,
        stylesheet: false,
        _watchDirectory: watchEvents.watchDirectory,
        _buildBundle: async () => {
          builds += 1;
          if (failNextBuild) {
            failNextBuild = false;
            signalFailedBuild?.();
            throw new Error("client bundle failed");
          }
          return { js: `// build-${builds}`, map: "" };
        },
      });
      const sseRes = await handle.fetch(new Request("http://localhost/_reload"));

      failNextBuild = true;
      watchEvents.emit("web/broken.tsx");
      await failedBuildSeen;
      const afterFailure = await handle.fetch(new Request("http://localhost/client.js"));
      expect(await afterFailure.text()).toBe("// build-1");

      watchEvents.emit("web/fixed.tsx");
      const frames = await readSseFrames(sseRes, { until: (frame) => frame.event === "reload" });
      const reloadedFiles = frames
        .filter((frame) => frame.event === "reload")
        .map((frame) => String(JSON.parse(frame.data)));
      expect(reloadedFiles).toEqual(["web/fixed.tsx"]);
      const afterFix = await handle.fetch(new Request("http://localhost/client.js"));
      expect(await afterFix.text()).toBe("// build-3");

      await handle.stop();
      handle = undefined;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// runDevApp gains resolvePageHead parity with
// runProdApp — both now call the same @cosmicdrift/kumiko-renderer/headless/apex
// resolveAndInjectPageHead, so a resolver produces the same tags in the
// same order under dev as under prod (see run-prod-app-static-files.test.ts's
// "resolver meta → og-tags appear" case for the prod-side equivalent). The
// real 300ms-timeout path is covered once, in headless's own unit test for
// resolveAndInjectPageHead (same shared function) — no need to re-run a slow
// timeout wait here too.
describe("createKumikoServer resolvePageHead", () => {
  test("resolver meta → head tags injected, same tags + order as runProdApp", async () => {
    handle = await createKumikoServer({
      features: [probeFeature],
      port: 0,
      installSignalHandlers: false,
      resolvePageHead: async () => ({
        title: "Vehicle X",
        description: "A car",
        ogImage: "https://x/i.png",
      }),
    });
    const res = await handle.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("<title>Kumiko</title>");
    expect((body.match(/kumiko-page-head/g) ?? []).length).toBe(1);
    expect(body).toContain("<title>Vehicle X</title>");
    expect(body).toContain('<meta name="description" content="A car" />');
    expect(body).toContain('<meta property="og:title" content="Vehicle X" />');
    expect(body).toContain('<meta property="og:description" content="A car" />');
    expect(body).toContain('<meta property="og:image" content="https://x/i.png" />');

    const titleIdx = body.indexOf("<title>Vehicle X</title>");
    const descIdx = body.indexOf('<meta name="description"');
    const ogTitleIdx = body.indexOf('<meta property="og:title"');
    const ogDescIdx = body.indexOf('<meta property="og:description"');
    const ogImageIdx = body.indexOf('<meta property="og:image"');
    expect(titleIdx).toBeLessThan(descIdx);
    expect(descIdx).toBeLessThan(ogTitleIdx);
    expect(ogTitleIdx).toBeLessThan(ogDescIdx);
    expect(ogDescIdx).toBeLessThan(ogImageIdx);
  });

  test("resolver throws → 200 with the unchanged default shell, not a 500", async () => {
    handle = await createKumikoServer({
      features: [probeFeature],
      port: 0,
      installSignalHandlers: false,
      resolvePageHead: async () => {
        throw new Error("boom");
      },
    });
    const res = await handle.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("kumiko-page-head");
    expect(body).toMatch(/<div id="root">/);
  });

  test("resolver returns null → 200 with the unchanged default shell", async () => {
    handle = await createKumikoServer({
      features: [probeFeature],
      port: 0,
      installSignalHandlers: false,
      resolvePageHead: async () => null,
    });
    const res = await handle.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("kumiko-page-head");
  });

  test("no resolvePageHead configured → no page-head marker in the response", async () => {
    const h = await boot();
    const res = await h.fetch(new Request("http://localhost/"));
    expect(await res.text()).not.toContain("kumiko-page-head");
  });
});

// tryHonoFirst used to decide "no route matched"
// purely from the status code — a matched httpRoute answering 404 on
// purpose (e.g. default-deny reads) was indistinguishable from an
// unregistered path and got silently rewritten to the SPA shell with
// status 200. Drives the REAL fetch-handler end to end (real Postgres,
// real Hono app via createKumikoServer) so the fix's actual wiring
// (buildServer's app.notFound() marker + tryHonoFirst reading it) is
// under test, not just the pure-function pin in try-hono-first.test.ts.
const probeHttpRouteFeature = defineFeature("dev-server-probe-http-route", (r) => {
  r.httpRoute({
    method: "GET",
    path: "/probe/:id",
    anonymous: true,
    handler: async (c) => {
      const id = c.req.param("id");
      if (id === "missing") return c.text("not found", 404);
      return c.text(`probe:${id}`, 200);
    },
  });
});

describe("createKumikoServer — tryHonoFirst 404-vs-router-miss (#2435)", () => {
  async function bootWithProbeRoute(): Promise<KumikoServerHandle> {
    handle = await createKumikoServer({
      features: [probeHttpRouteFeature],
      port: 0,
      installSignalHandlers: false,
    });
    return handle;
  }

  test("gematchte httpRoute mit bewusster 404 bleibt 404 (keine SPA-Maskierung)", async () => {
    const h = await bootWithProbeRoute();
    const res = await h.fetch(new Request("http://localhost/probe/missing"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/html/);
    expect(await res.text()).toBe("not found");
  });

  test("gematchte httpRoute mit Treffer antwortet normal (200)", async () => {
    const h = await bootWithProbeRoute();
    const res = await h.fetch(new Request("http://localhost/probe/exists"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("probe:exists");
  });

  test("unbekannte SPA-Route liefert weiterhin die SPA-Shell (200 HTML)", async () => {
    const h = await bootWithProbeRoute();
    const res = await h.fetch(new Request("http://localhost/some/client-side/route"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toMatch(/<div id="root">/);
  });

  test("kein Router-miss-Marker leakt an den Client", async () => {
    const h = await bootWithProbeRoute();
    const missRes = await h.fetch(new Request("http://localhost/some/client-side/route"));
    const deniedRes = await h.fetch(new Request("http://localhost/probe/missing"));
    expect(missRes.headers.has(NO_ROUTE_MATCH_HEADER_NAME)).toBe(false);
    expect(deniedRes.headers.has(NO_ROUTE_MATCH_HEADER_NAME)).toBe(false);
  });
});

const probeJobFeature = defineFeature("dev-server-probe-job", (r) => {
  r.job("probe-job", { trigger: { manual: true }, runIn: "worker" }, async () => {});
});

// Scoped to one boot's prefix: parallel test files boot their own dev servers
// on the same Redis, so a global `bull:kumiko-dev-*` diff sees their live keys.
async function listQueueKeysOfBoot(jobQueueNamePrefix: string): Promise<string[]> {
  const { Redis } = await import("ioredis");
  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl === undefined) throw new Error("REDIS_URL must be set for integration tests");
  const raw = new Redis(redisUrl);
  try {
    const keys = new Set<string>();
    for await (const batch of raw.scanStream({
      match: `bull:${jobQueueNamePrefix}-*`,
      count: 500,
    })) {
      for (const key of batch) keys.add(key);
    }
    return [...keys];
  } finally {
    raw.disconnect();
  }
}

describe("createKumikoServer — ephemeral job queues", () => {
  test("stop() removes the per-boot BullMQ keys from the shared Redis", async () => {
    handle = await createKumikoServer({
      features: [probeFeature, probeJobFeature],
      port: 0,
      installSignalHandlers: false,
    });
    const { jobQueueNamePrefix } = handle;
    expect(jobQueueNamePrefix).toStartWith("kumiko-dev-");
    expect((await listQueueKeysOfBoot(jobQueueNamePrefix)).length).toBeGreaterThan(0);

    await handle.stop();
    handle = undefined;

    expect(await listQueueKeysOfBoot(jobQueueNamePrefix)).toEqual([]);
  });
});

describe("createKumikoServer — real Bun.serve socket resolves the client IP (fw#3260 addendum)", () => {
  // Every other test in this file drives h.fetch()/handle.fetch() directly,
  // bypassing Bun.serve's real TCP socket entirely — none of them can catch
  // a regression where handleFetch loses the socket address before it
  // reaches requestContext.ip (see client-ip.ts: falls back to "unknown"
  // rather than throwing, so a wiring bug here stays silent otherwise).
  test("a real loopback connection resolves to the actual socket address, not 'unknown'", async () => {
    handle = await createKumikoServer({
      features: [probeFeature],
      port: 0,
      installSignalHandlers: false,
      anonymousAccess: { defaultTenantId: TENANT_ID },
    });
    const port = handle.server?.port;
    if (port === undefined) throw new Error("expected handle.server to be listening");

    const res = await fetch(`http://127.0.0.1:${port}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "dev-server-probe:query:whoami", payload: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { ip?: string } };
    // See the matching prod-side test (run-prod-app.integration.test.ts)
    // for why the assertion matches the loopback family instead of a
    // fixed literal (IPv4 vs. IPv4-mapped IPv6 is a platform detail).
    expect(body.data?.ip).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
  });
});
