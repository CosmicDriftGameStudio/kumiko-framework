import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { createKumikoServer, type KumikoServerHandle } from "../create-kumiko-server";

// Integration-Test: bootet createKumikoServer mit echtem Postgres,
// echtem Redis, echter Kumiko-Pipeline. Treibt den fetch-Handler
// direkt an (nicht über Bun.serve + Socket), weil vitest unter Node
// läuft. Unter Bun würde derselbe Handler identisch antworten —
// das Routing ist runtime-neutral.

const probeEntity = createEntity({
  fields: {
    title: createTextField({ required: true }),
    done: createBooleanField(),
  },
  table: "kumiko_server_probe",
});

const probeFeature = defineFeature("dev-server-probe", (r) => {
  r.entity("probe", probeEntity);
  // SystemAdmin-gated write — Ziel des extraRoutes.dispatchSystemWrite-
  // Tests (252/2): Echo von user.tenantId + roles beweist Dispatch durch
  // den echten Dispatcher (Zod + Access-Check) mit Ziel-Tenant-SystemUser.
  r.writeHandler({
    name: "probe-write",
    schema: z.object({ note: z.string() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event) => ({
      isSuccess: true as const,
      data: { tenantSeen: event.user.tenantId, roles: event.user.roles },
    }),
  });
});

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
    // Reload-Snippet wurde in </body> injiziert.
    expect(body).toMatch(/EventSource\("\/_reload"\)/);
  });

  test("GET /client.js → 404 wenn clientEntry fehlt (Route nicht registriert)", async () => {
    // Pre-multi-entry-Refactor lieferte das eine 200 mit leerem Body —
    // war eine Quirky Backwards-Compat. Mit der Multi-Entry-Engine wird
    // /client.js erst registriert wenn ein Entry vorhanden ist (kein
    // entries → kein Bundle-Asset-Path → 404 ist korrekt).
    const h = await boot();
    const res = await h.fetch(new Request("http://localhost/client.js"));
    expect(res.status).toBe(404);
  });

  test("Single-Entry: clientEntry='client.tsx' liefert Bundle unter /client.js", async () => {
    // Backwards-Compat-Smoke: existierende Samples (designer, ui-walkthrough,
    // beammycar, …) nutzen clientEntry — der normalize-Pfad muss daraus
    // `/client.js` als Asset-Path ableiten. Test injiziert via _buildBundle
    // einen Stub damit der Body deterministisch geprüft werden kann (kein
    // Bun.build unter Node).
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
    // /api/ghost existiert nicht → Hono liefert 404. Der entscheidende
    // Punkt: die Response kommt VOM Stack, nicht vom Dev-Server-Layer.
    // Wir unterscheiden, indem wir prüfen, dass es KEINE HTML- oder
    // event-stream-Response ist — die gehören zum Dev-Server-Layer.
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

// Multi-Entry-Mode — exerciert clientEntries + hostDispatch (Discriminated-
// Union). Bun.build wird via _buildBundle gestubbt; der Routing-Pfad
// (HTML-Dispatch pro Host + Bundle-Routing pro Asset-Path) ist runtime-
// neutral und wird hier vollständig getrieben. Echte Bundle-Produktion
// deckt die `kumiko-build CLI`-Suite (build-prod-bundle.integration.ts) ab.
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
      // Stub: der Bundle-Inhalt enthält den Entry-Namen damit der Test
      // beweisen kann dass /client-public.js ≠ /client-admin.js. Echtes
      // Bun.build würde unterschiedlich-gehashte Bundles produzieren —
      // wir simulieren das mit deterministischen Markern.
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
          return { kind: "html", entryName: "admin", injectSchema: true };
        }
        return { kind: "html", entryName: "public", injectSchema: false };
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

    // Cross-routing existiert NICHT — /client.js (Single-Entry-Pfad)
    // ist im Multi-Mode kein registrierter Asset-Path.
    const noFallback = await handle.fetch(new Request("http://localhost/client.js"));
    expect(noFallback.status).toBe(404);
  });

  test("Schema-Inject: admin → injected, public → NICHT injected", async () => {
    handle = await bootMultiEntry();

    const publicHtml = await (
      await handle.fetch(
        new Request("http://status.localhost/", { headers: { host: "status.localhost" } }),
      )
    ).text();
    expect(publicHtml).not.toMatch(/__KUMIKO_SCHEMA__/);

    const adminHtml = await (
      await handle.fetch(
        new Request("http://admin.localhost/", { headers: { host: "admin.localhost" } }),
      )
    ).text();
    expect(adminHtml).toMatch(/__KUMIKO_SCHEMA__/);
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
});

// 252/2: der Dev-Pfad bekommt dieselbe extraRoutes-deps-Closure wie
// runProdApp (seit der Extraktion nach extra-routes-deps.ts geteilt) —
// hier der analoge Beweis gegen createKumikoServer.
describe("createKumikoServer extraRoutes-deps", () => {
  test("dispatchSystemWrite schreibt als SystemAdmin des Ziel-Tenants, registry verfügbar", async () => {
    const tenantId = "00000000-0000-4000-8000-000000000042";
    let registryHasProbe = false;
    handle = await createKumikoServer({
      features: [probeFeature],
      port: 0,
      installSignalHandlers: false,
      extraRoutes: (app, deps) => {
        registryHasProbe = deps.registry.features.has("dev-server-probe");
        app.post("/webhook-probe", async (c) => {
          const result = await deps.dispatchSystemWrite({
            handlerQn: "dev-server-probe:write:probe-write",
            payload: { note: "from-webhook" },
            tenantId: tenantId as import("@cosmicdrift/kumiko-framework/engine").TenantId,
          });
          return c.json(result);
        });
      },
    });

    expect(registryHasProbe).toBe(true);

    const res = await handle.fetch(new Request("http://test/webhook-probe", { method: "POST" }));
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
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("createKumikoServer — hot-reload broadcast", () => {
  test("file change under web/ rebuilds and broadcasts SSE reload", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kumiko-watch-"));
    const entry = join(tmpDir, "client.tsx");
    const webDir = join(tmpDir, "web");
    mkdirSync(webDir);
    writeFileSync(entry, "export const ping = 1;\n");

    let builds = 0;
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
        clientEntry: entry,
        stylesheet: false,
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
      const reader = sseRes.body?.getReader();
      expect(reader).toBeDefined();
      if (!reader) return;

      await reader.read(); // drain connected comment

      const initialBuilds = builds;
      writeFileSync(join(webDir, "page.tsx"), "export const x = 1;\n");

      const deadline = Date.now() + 3000;
      let sawReload = false;
      while (Date.now() < deadline && !sawReload) {
        const readPromise = reader.read();
        const timeout = new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), 200),
        );
        const { value, done } = await Promise.race([readPromise, timeout]);
        if (done || value === undefined) continue;
        const chunk = new TextDecoder().decode(value);
        if (chunk.includes("event: reload")) sawReload = true;
      }
      await reader.cancel();

      expect(builds).toBeGreaterThan(initialBuilds);
      expect(sawReload).toBe(true);

      const js = await handle.fetch(new Request("http://localhost/client.js"));
      expect(await js.text()).toMatch(/build-/);

      // Abort watchers before teardown rmSync can fire a restart event.
      await handle.stop();
      handle = undefined;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
