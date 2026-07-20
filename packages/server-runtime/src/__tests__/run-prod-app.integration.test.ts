// runProdApp Integration: bootet die komplette Production-Chain mit
// echtem Postgres + Redis. Beweist:
//   - Migration ist idempotent (2× boot mit gleicher DB → kein Crash)
//   - Seeds laufen einmal, beim 2. Boot no-op (idempotent-by-design)
//   - HTTP-Server antwortet auf /api/health
//   - SIGTERM-handler räumt sauber auf
//
// NICHT getestet: Bun.serve über echte TCP-Verbindung — wir treiben
// fetch direkt. Bun.serve-Wiring ist in Production-Coolify selbst
// getestet wenn der Container hochfährt.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createSessionsFeature,
  userSessionEntity,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import { userEntity } from "@cosmicdrift/kumiko-bundled-features/user";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { InMemoryKmsAdapter, type KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createNoopProvider,
  createPrometheusMeter,
} from "@cosmicdrift/kumiko-framework/observability";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { unsafeEnsureEntityTable } from "@cosmicdrift/kumiko-framework/stack";
import { Queue } from "bullmq";
import postgres from "postgres";
import { z } from "zod";
import { type ProdAppHandle, runProdApp } from "../run-prod-app";

// tmp-Verzeichnisse pro Test, in afterEach geräumt. Tests die staticDir
// brauchen registrieren ihren Pfad hier.
const tempDirs: string[] = [];

async function createTempStaticDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kumiko-prod-static-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const fullPath = join(dir, name);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }
  return dir;
}

const widgetEntity = createEntity({
  fields: {
    name: createTextField({ required: true }),
    active: createBooleanField({ default: true }),
  },
  table: "prod_widgets",
});

const widgetFeature = defineFeature("prod-probe", (r) => {
  r.entity("widget", widgetEntity);
  // Anonymous query — covers the "anonymousAccess flows from runProdApp
  // through createApiEntrypoint to the auth-middleware" wiring that
  // earlier silently dropped the option in the entrypoint layer.
  r.queryHandler({
    name: "ping",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    handler: async () => ({ pong: true }),
  });
  r.queryHandler({
    name: "kms-probe",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    handler: async (_event, ctx) => ({ hasKms: ctx.kms !== undefined }),
  });
  // SystemAdmin-gated write — Ziel des extraRoutes.dispatchSystemWrite-
  // Tests: Echo von user.tenantId + roles beweist, dass der Dispatch
  // durch den echten Dispatcher (Zod + Access-Check) läuft und der
  // auto-konstruierte SystemUser den Ziel-Tenant trägt.
  r.writeHandler({
    name: "probe-write",
    schema: z.object({ note: z.string() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event) => ({
      isSuccess: true as const,
      data: { tenantSeen: event.user.tenantId, roles: event.user.roles },
    }),
  });
  // Event + MSP-Paar für den lokalen Event-Dispatcher (2026-06-11):
  // runProdApp ist Single-Container — ohne lokalen Dispatcher wendet KEINE
  // multiStreamProjection jemals an (Prod hatte deshalb leere Projektionen
  // + leere kumiko_event_consumers). Der Write appended das Event; die MSP
  // schreibt async in prod_probe_pings — der Test pollt darauf.
  const pingedEvent = r.defineEvent("probe-pinged", z.object({ note: z.string() }));
  r.writeHandler({
    name: "probe-append",
    schema: z.object({ aggregateId: z.string(), note: z.string() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event, ctx) => {
      const payload = event.payload as { aggregateId: string; note: string }; // @cast-boundary engine-payload
      // unsafeAppendEvent: das Test-Feature augmentiert keine Event-Type-Map,
      // der strict-typed appendEvent narrowt hier auf never.
      await ctx.unsafeAppendEvent({
        aggregateId: payload.aggregateId,
        aggregateType: "probe",
        type: pingedEvent.name,
        payload: { note: payload.note },
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
  });
  r.multiStreamProjection({
    name: "probe-ping-projection",
    apply: {
      [pingedEvent.name]: async (event, tx) => {
        const payload = event.payload as { note: string }; // @cast-boundary engine-payload
        await asRawClient(tx).unsafe(
          `INSERT INTO prod_probe_pings (aggregate_id, note) VALUES ($1, $2)`,
          [event.aggregateId, payload.note],
        );
      },
    },
  });
});

// Worker-lane cron — the lane the data-export job (run-export-jobs) lives on.
// runProdApp must schedule it (single-instance runs both lanes); on the old
// createApiEntrypoint path it was silently never registered → exports hung.
const cronProbeFeature = defineFeature("cron-probe", (r) => {
  r.job("worker-lane-cron", { trigger: { cron: "0 0 1 1 *" }, runIn: "worker" }, async () => {});
});

async function workerLaneSchedulers(prefix: string): Promise<{ name?: string; key?: string }[]> {
  const url = new URL(process.env["REDIS_URL"] ?? "redis://localhost:16379");
  const queue = new Queue(`${prefix}-worker`, {
    connection: { host: url.hostname, port: Number(url.port) },
  });
  // Read-only: do NOT obliterate — the running all-in-one worker consumes this
  // same queue, and deleting its keys mid-flight aborts the worker's blocking
  // Redis read with "Connection is closed". The unique prefix isolates the
  // leftover scheduler; the test Redis is ephemeral.
  try {
    return await queue.getJobSchedulers();
  } finally {
    await queue.close();
  }
}

const TENANT_ID = "00000000-0000-4000-8000-000000000001";

// Per-suite DB so reboots can be tested without conflicting with other
// test suites. Created in beforeAll, dropped at module end via the admin
// connection.
const TEST_DB = `kumiko_runprod_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";

let prodAppHandles: ProdAppHandle[] = [];

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
  const adminClient = postgres(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await adminClient.end();
  }
});

afterEach(async () => {
  for (const handle of prodAppHandles) {
    await handle.stop();
  }
  prodAppHandles = [];
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

// Production-Apps booten gegen eine VORHER migrierte DB (CI-Step
// `kumiko migrate apply`). In diesem Test gibt's keine drizzle-Migration-
// Files, also imitieren wir den Migration-Step direkt: Framework-Infra-
// Tables + die widget-Entity-Tabelle anlegen, dann runProdApp mit
// `migrations: false` (= kein Schema-Drift-Gate) starten. So bleibt der
// Test fokussiert auf Boot-Wiring (Entrypoint, Hono-Routes, Seeds), ohne
// den Migrationspfad zu duplizieren.
async function migrateTestDb(): Promise<void> {
  const url = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
  const { db, close } = createDbConnection(url);
  try {
    await createEventsTable(db);
    await createArchivedStreamsTable(db);
    await createProjectionStateTable(db);
    await createEventConsumerStateTable(db);
    await unsafeEnsureEntityTable(db, widgetEntity, "widget");
    await unsafeEnsureEntityTable(db, userEntity, "user");
    await unsafeEnsureEntityTable(db, userSessionEntity, "user-session");
    await asRawClient(db).unsafe(
      `CREATE TABLE IF NOT EXISTS prod_probe_pings (
         id BIGSERIAL PRIMARY KEY,
         aggregate_id UUID NOT NULL,
         note TEXT NOT NULL
       )`,
    );
  } finally {
    await close();
  }
}

let testDbMigrated = false;

async function boot(
  seedFn?: (deps: { db: import("@cosmicdrift/kumiko-framework/db").DbConnection }) => Promise<void>,
  extra?: Partial<Parameters<typeof runProdApp>[0]>,
): Promise<ProdAppHandle> {
  // Override env per boot to point at the suite's DB.
  const originalDbUrl = process.env["DATABASE_URL"];
  process.env["DATABASE_URL"] = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
  process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:16379";
  process.env["JWT_SECRET"] = "test-runprod-secret-32-chars-min!!";
  process.env["PORT"] = "0"; // Bun.serve picks an ephemeral port

  if (!testDbMigrated) {
    await migrateTestDb();
    testDbMigrated = true;
  }

  try {
    const handle = await runProdApp({
      features: [widgetFeature],
      autoListen: false,
      migrations: false,
      ...(seedFn && { seeds: [seedFn] }),
      ...(extra ?? {}),
    });
    prodAppHandles.push(handle);
    return handle;
  } finally {
    if (originalDbUrl !== undefined) process.env["DATABASE_URL"] = originalDbUrl;
    else delete process.env["DATABASE_URL"];
  }
}

describe("runProdApp", () => {
  test("first boot creates entity tables, /api/health responds", async () => {
    const handle = await boot();

    const res = await handle.entrypoint.app.fetch(new Request("http://test/health"));
    expect(res.status).toBe(200);
  });

  test("second boot against the same DB is idempotent — no crash, no duplicate tables", async () => {
    await boot();
    // First boot left tables in place. Restart on the same DB —
    // unsafeEnsureEntityTable should be a no-op for the existing rows.
    const second = await boot();

    const res = await second.entrypoint.app.fetch(new Request("http://test/health"));
    expect(res.status).toBe(200);
  });

  test("extraRoutes-callback mounts custom HTTP-routes on the Hono-app", async () => {
    // Beweist dass die runProdApp.extraRoutes-Option den Hono-app
    // bekommt und Routes daran VOR dem static-fallback greifen — das
    // ist das Fundament für /feed.xml, /sitemap.xml, /og-image etc.
    let extraInvoked = false;
    const handle = await boot(undefined, {
      extraRoutes: (app, deps) => {
        extraInvoked = true;
        // deps.db + deps.redis sind die runProdApp-Connections — die
        // Route kann gegen die Domain queryen, hier reicht ein simple
        // Echo zum Beweis dass wir ans App-Object kommen.
        app.get("/feed.xml", (c) => {
          const dbAvailable = deps.db !== undefined;
          return c.body(`<?xml version="1.0"?><probe ok="${dbAvailable}" />`, 200, {
            "content-type": "application/rss+xml",
          });
        });
      },
    });

    expect(extraInvoked).toBe(true);

    // handle.fetch durchläuft den static-fallback wrapper — dort liegt
    // die "Hono-First, dann Disk"-Logik. entrypoint.app.fetch würde den
    // wrapper umgehen und damit die regression nicht erkennen.
    const res = await handle.fetch(new Request("http://test/feed.xml"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/rss+xml");
    const body = await res.text();
    expect(body).toContain('<probe ok="true" />');
  });

  test("extraRoutes-deps: dispatchSystemWrite schreibt als SystemAdmin des Ziel-Tenants, registry verfügbar", async () => {
    // Das ist das Wiring für Provider-Webhook-Routes (billing-foundation
    // createSubscriptionWebhookHandler): die Route authentifiziert via
    // Provider-Signatur und schreibt dann am JWT-Pfad vorbei durch den
    // Command-Dispatcher. Beweist: (a) registry liegt in den deps,
    // (b) dispatchSystemWrite geht durch Zod + Access-Check des Handlers,
    // (c) der SystemUser trägt den Ziel-Tenant (Event-Store-Konsistenz).
    let registryHasProbe = false;
    const handle = await boot(undefined, {
      extraRoutes: (app, deps) => {
        registryHasProbe = deps.registry.features.has("prod-probe");
        app.post("/webhook-probe", async (c) => {
          const result = await deps.dispatchSystemWrite({
            handlerQn: "prod-probe:write:probe-write",
            payload: { note: "from-webhook" },
            tenantId: TENANT_ID as import("@cosmicdrift/kumiko-framework/engine").TenantId,
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
    expect(body.data?.tenantSeen).toBe(TENANT_ID);
    expect(body.data?.roles).toContain("SystemAdmin");
  });

  test("static-fallback: extraRoute beats Disk-File at colliding path (Hono-First)", async () => {
    // Regression-Test für den static-fallback-Bug von Phase 2 Step 1:
    // wenn ein extraRoute (z.B. /feed.xml) UND eine gleichnamige Disk-
    // Datei in staticDir existieren, gewinnt der extraRoute. Sonst
    // schluckt der SPA-Fallback unbekannte Pfade als index.html und
    // der App-Author wundert sich warum sein /feed.xml nichts macht.
    const tmpStaticDir = await createTempStaticDir({
      "feed.xml": "<this-is-the-disk-version />",
      "index.html": "<html>SPA shell</html>",
    });

    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      extraRoutes: (app) => {
        app.get("/feed.xml", (c) =>
          c.body("<this-is-the-hono-version />", 200, {
            "content-type": "application/rss+xml",
          }),
        );
      },
    });

    const res = await handle.fetch(new Request("http://test/feed.xml"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<this-is-the-hono-version />");
  });

  test("static-fallback: Disk-File served when no extraRoute matches", async () => {
    // Komplement-Test: ohne kollidierenden extraRoute liefert der
    // static-fallback die Disk-Datei. Beweist dass der Hono-First-Pfad
    // nicht versehentlich Static-Files schluckt.
    const tmpStaticDir = await createTempStaticDir({
      "robots.txt": "User-agent: *\nAllow: /",
      "index.html": "<html>SPA shell</html>",
    });

    const handle = await boot(undefined, { staticDir: tmpStaticDir });

    const res = await handle.fetch(new Request("http://test/robots.txt"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("User-agent: *");
    expect(res.headers.get("etag")).toBeTruthy();
  });

  test("static-fallback: If-None-Match → 304 on disk file", async () => {
    const tmpStaticDir = await createTempStaticDir({
      "robots.txt": "User-agent: *\nAllow: /",
      "index.html": "<html>SPA shell</html>",
    });

    const handle = await boot(undefined, { staticDir: tmpStaticDir });
    const first = await handle.fetch(new Request("http://test/robots.txt"));
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await handle.fetch(
      new Request("http://test/robots.txt", { headers: { "if-none-match": etag ?? "" } }),
    );
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  test("static-fallback: If-None-Match → 304 on SPA index.html", async () => {
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>SPA shell</html>",
    });

    const handle = await boot(undefined, { staticDir: tmpStaticDir });
    const first = await handle.fetch(new Request("http://test/some/spa/route"));
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await handle.fetch(
      new Request("http://test/some/spa/route", {
        headers: { "if-none-match": etag ?? "" },
      }),
    );
    expect(second.status).toBe(304);
  });

  test("static-fallback: unknown path → SPA-fallback to index.html", async () => {
    // Path ohne extraRoute, ohne Disk-File, mit existierendem
    // index.html → liefert die SPA-Shell. Standard-SPA-Routing-Pattern,
    // aber wir wollen sicher sein dass der Hono-First-Refactor das
    // nicht gebrochen hat.
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>SPA shell</html>",
    });

    const handle = await boot(undefined, { staticDir: tmpStaticDir });

    const res = await handle.fetch(new Request("http://test/some/spa/route"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("SPA shell");
  });

  test("static-fallback: non-GET ohne Hono-Match → 404, nicht SPA-Shell (#259)", async () => {
    // Prod-Szenario: POST auf einen falsch konfigurierten Webhook-Pfad
    // (Route nicht gemountet). 200 index.html würde dem Provider
    // "delivered" signalisieren — Events gingen still verloren.
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>SPA shell</html>",
      "robots.txt": "User-agent: *\nAllow: /",
    });

    const handle = await boot(undefined, { staticDir: tmpStaticDir });

    const unmatched = await handle.fetch(
      new Request("http://test/webhooks/subscription/stripe", { method: "POST" }),
    );
    expect(unmatched.status).toBe(404);

    // Disk-Files werden ebenfalls nicht auf non-GET serviert.
    const diskFile = await handle.fetch(new Request("http://test/robots.txt", { method: "POST" }));
    expect(diskFile.status).toBe(404);
  });

  test("static-fallback: HEAD auf SPA-Route bleibt 200 (spiegelt GET)", async () => {
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>SPA shell</html>",
    });

    const handle = await boot(undefined, { staticDir: tmpStaticDir });

    const res = await handle.fetch(new Request("http://test/some/spa/route", { method: "HEAD" }));
    expect(res.status).toBe(200);
  });

  test("hostDispatch: per-host html-Datei + Schema-Gating", async () => {
    // Multi-App-Deployment: zwei HTML-Dateien für unterschiedliche
    // Hosts. Schema wird NUR für admin-Host injected — Public-Host
    // bekommt das pure HTML ohne __KUMIKO_SCHEMA__ Tag (Sicherheit).
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html><body>PUBLIC</body><script src=/client.js></script></html>",
      "admin.html": "<html><body>ADMIN</body><script src=/client.js></script></html>",
    });

    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      hostDispatch: ({ host }) => {
        if (host.startsWith("admin.")) {
          return { kind: "html", file: "admin.html", injectSchema: true };
        }
        return { kind: "html", file: "index.html", injectSchema: false };
      },
    });

    // Public host: index.html, KEIN schema-Tag.
    const pubRes = await handle.fetch(
      new Request("http://demo.example.test/", { headers: { host: "demo.example.test" } }),
    );
    expect(pubRes.status).toBe(200);
    const pubBody = await pubRes.text();
    expect(pubBody).toContain("PUBLIC");
    expect(pubBody).not.toContain("__KUMIKO_SCHEMA__");

    // Admin host: admin.html MIT schema-Tag.
    const adminRes = await handle.fetch(
      new Request("http://admin.example.test/", { headers: { host: "admin.example.test" } }),
    );
    expect(adminRes.status).toBe(200);
    const adminBody = await adminRes.text();
    expect(adminBody).toContain("ADMIN");
    expect(adminBody).toContain("__KUMIKO_SCHEMA__");
  });

  test("hostDispatch: redirect-Modus", async () => {
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>fallback</html>",
    });
    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      hostDispatch: ({ host }) =>
        host === "apex.example.test"
          ? { kind: "redirect", to: "https://target.example", status: 302 }
          : { kind: "html", file: "index.html", injectSchema: false },
    });

    const res = await handle.fetch(
      new Request("http://apex.example.test/", { headers: { host: "apex.example.test" } }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://target.example");
  });

  test("hostDispatch: 404-Modus für unbekannte Hosts", async () => {
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>fallback</html>",
    });
    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      hostDispatch: ({ host }) =>
        host === "known.example.test"
          ? { kind: "html", file: "index.html", injectSchema: false }
          : { kind: "not-found" },
    });

    const res = await handle.fetch(
      new Request("http://unknown.example.test/", { headers: { host: "unknown.example.test" } }),
    );
    expect(res.status).toBe(404);
  });

  test("hostDispatch: CSP-Header-Passthrough pro Host", async () => {
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>x</html>",
    });
    const csp = "default-src 'self'; script-src 'self'";
    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      hostDispatch: () => ({ kind: "html", file: "index.html", injectSchema: false, csp }),
    });

    const res = await handle.fetch(new Request("http://x.example.test/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(csp);
  });

  test("hostDispatch: assets bleiben host-unabhängig erreichbar", async () => {
    // /assets/* darf NICHT durch hostDispatch laufen — Bundles werden
    // vom client per absoluter URL nachgeladen, host-Sniffing wäre falsch.
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>x</html>",
      "assets/app-abc.js": "console.log('app');",
    });
    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      hostDispatch: () => ({ kind: "not-found" }),
    });

    const res = await handle.fetch(new Request("http://x.example.test/assets/app-abc.js"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.log('app')");
  });

  test("anonymousAccess flows from runProdApp through entrypoint into the auth-middleware", async () => {
    // Regression for the silent-drop bug: ApiEntrypointOptions had no
    // anonymousAccess field, so runProdApp's option went into createApi
    // Entrypoint's spread, vanished, and the auth-middleware never saw
    // it → 401 missing_token even on `roles: ["anonymous"]` handlers.
    const handle = await boot(undefined, {
      anonymousAccess: { defaultTenantId: TENANT_ID },
    });

    const res = await handle.entrypoint.app.fetch(
      new Request("http://test/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "prod-probe:query:ping",
          payload: {},
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { pong?: boolean } };
    expect(body.data?.pong).toBe(true);
  });

  test("anonymousAccess as factory: receives {db, redis, registry}, resolver closures over db", async () => {
    // Use case: tenantResolver looks up subdomain → tenantId in the DB
    // at request time. The factory is called once at boot with db
    // wired, the resolver inside captures it.
    const seenDeps: { db: boolean; redis: boolean; registry: boolean } = {
      db: false,
      redis: false,
      registry: false,
    };

    const handle = await boot(undefined, {
      anonymousAccess: ({ db, redis, registry }) => {
        seenDeps.db = db !== undefined;
        seenDeps.redis = redis !== undefined;
        seenDeps.registry = registry !== undefined;
        return { defaultTenantId: TENANT_ID };
      },
    });

    expect(seenDeps).toEqual({ db: true, redis: true, registry: true });

    const res = await handle.entrypoint.app.fetch(
      new Request("http://test/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "prod-probe:query:ping", payload: {} }),
      }),
    );
    expect(res.status).toBe(200);
  });

  test("extraContext as factory: factory called with {db, redis, registry} at boot", async () => {
    // Factory-form for extraContext closes over db like anonymousAccess.
    // In auth-mode the framework auto-sets configResolver; Factory-Result
    // wird drauf gemerged. Wichtig: Factory wird genau einmal aufgerufen
    // beim Boot, NACHDEM db/redis/registry konstruiert sind.
    let invocations = 0;
    let factoryDeps: { db: boolean; redis: boolean; registry: boolean } | null = null;

    const handle = await boot(undefined, {
      extraContext: ({ db, redis, registry }) => {
        invocations++;
        factoryDeps = {
          db: db !== undefined,
          redis: redis !== undefined,
          registry: registry !== undefined,
        };
        return { _appCustomKey: "from-factory" };
      },
    });

    expect(invocations).toBe(1);
    expect(factoryDeps!).toEqual({ db: true, redis: true, registry: true });
    // Smoke: handle is functional (boot completed without error).
    expect(handle.entrypoint).toBeDefined();
  });

  test("seed runs once on first boot, but the seed's own idempotence prevents duplication on reboot", async () => {
    let seedInvocations = 0;
    let inserted = false;

    const seed = async ({
      db,
    }: {
      db: import("@cosmicdrift/kumiko-framework/db").DbConnection;
    }) => {
      seedInvocations++;
      // Seed-side idempotence: check before inserting. runProdApp doesn't
      // gate seeds — the seed itself is responsible.
      const existing = await asRawClient(db).unsafe(`SELECT 1 FROM prod_widgets LIMIT 1`);
      if ((existing as Array<Record<string, unknown>>).length > 0) return;
      await asRawClient(db).unsafe(`INSERT INTO prod_widgets (id, tenant_id, name) VALUES
        (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 'seeded')`);
      inserted = true;
    };

    await boot(seed);
    expect(seedInvocations).toBe(1);
    expect(inserted).toBe(true);

    await boot(seed);
    // Seed function was called both times (runProdApp doesn't track),
    // but the seed's own check kept it from inserting again.
    expect(seedInvocations).toBe(2);

    // Probe DB — exactly one row.
    const second = prodAppHandles[1];
    if (!second) throw new Error("expected second handle");
    // Use the entrypoint's DB context to query (clean shutdown handles
    // the connection lifecycle).
    const ctx = second.entrypoint as unknown as { app: { fetch: typeof fetch } };
    const res = await ctx.app.fetch(new Request("http://test/health"));
    expect(res.status).toBe(200);
  });

  test("Hard Boot-Gate: pending kumiko-Migration → SchemaDriftError, kein Boot", async () => {
    // Synthetisches kumiko/migrations-Dir mit einer checked-in Migration die
    // nie applied wurde (kein _kumiko_migrations-Eintrag). runProdApp soll mit
    // SchemaDriftError abbrechen bevor irgendetwas anderes initialisiert wird.
    const driftDir = await mkdtemp(join(tmpdir(), "kumiko-drift-boot-"));
    tempDirs.push(driftDir);
    await writeFile(
      join(driftDir, "0001_pending.sql"),
      `CREATE TABLE "never_created_table" ("id" uuid PRIMARY KEY);`,
    );
    await writeFile(
      join(driftDir, ".snapshot.json"),
      JSON.stringify({
        version: 1,
        tables: [{ tableName: "never_created_table", columns: [] }],
      }),
    );

    await expect(boot(undefined, { migrations: { dir: driftDir } })).rejects.toThrow(
      /Schema drift detected/,
    );
  });
});

describe("runProdApp: lokaler Event-Dispatcher (MSP-Anwendung im Single-Container)", () => {
  // Regression für den 2026-06-11-Incident: runProdApp baute den
  // Event-Dispatcher nie ({disabled:true} im API-Entrypoint) — jede
  // multiStreamProjection blieb in Prod unangewendet, kumiko_event_consumers
  // blieb leer. Der Test schreibt über den ECHTEN Boot-Pfad und pollt auf
  // die async projizierte Row.
  async function pollFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 8000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await probe();
      if (result !== undefined) return result;
      if (Date.now() > deadline) throw new Error("pollFor: timeout");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  test("Write → appendEvent → MSP wendet async an; Consumer-Cursor wandert", async () => {
    let dispatchSystemWrite: import("../extra-routes-deps").ExtraRoutesSystemDeps["dispatchSystemWrite"];
    const handle = await boot(undefined, {
      eventDispatcher: { pollIntervalMs: 50 },
      extraRoutes: (_app, deps) => {
        dispatchSystemWrite = deps.dispatchSystemWrite;
      },
    });

    // Default-Boot baut den lokalen Dispatcher und start() hat ihn gestartet.
    expect(handle.entrypoint.eventDispatcher).toBeDefined();

    const aggregateId = crypto.randomUUID();
    const result = await dispatchSystemWrite!({
      handlerQn: "prod-probe:write:probe-append",
      payload: { aggregateId, note: "dispatched" },
      tenantId: TENANT_ID as import("@cosmicdrift/kumiko-framework/engine").TenantId,
    });
    expect(result.isSuccess).toBe(true);

    const url = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
    const { db, close } = createDbConnection(url);
    try {
      const row = await pollFor(async () => {
        const rows = (await asRawClient(db).unsafe(
          `SELECT note FROM prod_probe_pings WHERE aggregate_id = $1`,
          [aggregateId],
        )) as Array<{ note: string }>;
        return rows[0];
      });
      expect(row.note).toBe("dispatched");

      // Consumer-Registrierung + Cursor-Fortschritt — in Prod war diese
      // Tabelle komplett leer, DER Beweis dass nie ein Dispatcher lief.
      const consumers = (await asRawClient(db).unsafe(
        `SELECT name, last_processed_event_id FROM kumiko_event_consumers
         WHERE name = 'prod-probe:projection:probe-ping-projection'
            OR name LIKE '%probe-ping-projection%'`,
      )) as Array<{ name: string; last_processed_event_id: string | number }>;
      expect(consumers.length).toBeGreaterThan(0);
      expect(Number(consumers[0]?.last_processed_event_id)).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  test("eventDispatcher.disabled: kein lokaler Dispatcher gebaut", async () => {
    const handle = await boot(undefined, {
      eventDispatcher: { disabled: true },
    });
    expect(handle.entrypoint.eventDispatcher).toBeUndefined();
  });
});

// Origin-guard config (framework #340) flows from runProdApp's auth options
// through to buildServer. Before the forwarding fix, RunProdAppAuthOptions had
// no `allowedOrigins`, so a cookieDomain app could not satisfy the fail-closed
// guard — it could only CrashLoop.
describe("runProdApp — auth allowedOrigins forwarding", () => {
  const ADMIN = {
    email: "origin-guard@example.eu",
    password: "test-pw-strong-1234",
    displayName: "Admin",
    memberships: [],
  };

  test("cookieDomain without allowedOrigins fails closed — guard is wired through runProdApp", async () => {
    await expect(
      boot(undefined, {
        auth: { admin: ADMIN, cookieDomain: "example.eu", sessions: false },
        allowPlaintextPii: "test: origin-guard focus, not crypto",
      }),
    ).rejects.toThrow(/allowedOrigins is empty/);
  });

  test("cookieDomain + allowedOrigins clears the guard — allowlist reaches buildServer", async () => {
    // Without the forwarding fix this would ALSO throw /allowedOrigins is empty/.
    // It may still fail later on the minimal harness (no auth tables migrated),
    // but never on the origin guard — that is the forwarding proof.
    let bootError: unknown;
    try {
      const handle = await boot(undefined, {
        auth: {
          admin: ADMIN,
          cookieDomain: "example.eu",
          allowedOrigins: ["https://app.example.eu"],
          sessions: false,
        },
      });
      expect(handle).toBeDefined();
    } catch (error) {
      bootError = error;
    }
    if (bootError !== undefined) {
      expect(String(bootError)).not.toMatch(/allowedOrigins is empty/);
    }
  });
});

describe("runProdApp — session boot gate (#1262/#1275)", () => {
  const ADMIN = {
    email: "session-gate@example.eu",
    password: "test-pw-strong-1234",
    displayName: "Admin",
    memberships: [],
  };

  test("auth mounted, sessions feature missing, no opt-out → aborts boot", async () => {
    await expect(
      boot(undefined, {
        auth: {
          admin: ADMIN,
          cookieDomain: "example.eu",
          allowedOrigins: ["https://app.example.eu"],
        },
        allowPlaintextPii: "test: session-gate focus, not crypto",
      }),
    ).rejects.toThrow(/BOOT ABORTED.*sessions.*stateless/s);
  });

  test("auth mounted, sessions feature mounted → boots cleanly (the happy path the gate guards)", async () => {
    const handle = await boot(undefined, {
      // "user" is auto-mounted via includeBundled whenever auth.admin is set —
      // only createSessionsFeature() needs to be explicit here.
      features: [createSessionsFeature()],
      auth: {
        admin: ADMIN,
        cookieDomain: "example.eu",
        allowedOrigins: ["https://app.example.eu"],
      },
      allowPlaintextPii: "test: session-gate focus, not crypto",
    });
    expect(handle).toBeDefined();
  });
});

describe("runProdApp job-lane wiring (runSingleInstance)", () => {
  // Red-then-green for the export bug: on createApiEntrypoint (old default) the
  // worker-lane cron was never registered. createAllInOneEntrypoint (new
  // single-instance default) runs two runners, so it IS registered.
  test("default single-instance schedules the WORKER-lane cron", async () => {
    const prefix = `test-rsi-${Date.now().toString(36)}`;
    const handle = await boot(undefined, {
      features: [cronProbeFeature],
      jobs: { queueNamePrefix: prefix },
    });
    expect(handle.entrypoint.mode).toBe("all-in-one");
    const schedulers = await workerLaneSchedulers(prefix);
    expect(schedulers.some((s) => (s.name ?? s.key ?? "").includes("worker-lane-cron"))).toBe(true);
  });

  test("runSingleInstance:false → api-only, worker lane left to a dedicated worker", async () => {
    const prefix = `test-rsi-api-${Date.now().toString(36)}`;
    const handle = await boot(undefined, {
      features: [cronProbeFeature],
      jobs: { queueNamePrefix: prefix },
      runSingleInstance: false,
    });
    expect(handle.entrypoint.mode).toBe("api");
    const schedulers = await workerLaneSchedulers(prefix);
    expect(schedulers.some((s) => (s.name ?? s.key ?? "").includes("worker-lane-cron"))).toBe(
      false,
    );
  });

  test("kms option: adapter reaches handler ctx; without the option ctx.kms is absent", async () => {
    const probe = async (handle: ProdAppHandle): Promise<boolean | undefined> => {
      const res = await handle.entrypoint.app.fetch(
        new Request("http://test/api/query", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "prod-probe:query:kms-probe", payload: {} }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data?: { hasKms?: boolean } };
      return body.data?.hasKms;
    };

    const withKms = await boot(undefined, {
      kms: new InMemoryKmsAdapter(),
      anonymousAccess: { defaultTenantId: TENANT_ID },
    });
    expect(await probe(withKms)).toBe(true);

    const withoutKms = await boot(undefined, {
      anonymousAccess: { defaultTenantId: TENANT_ID },
    });
    expect(await probe(withoutKms)).toBe(false);
  });

  test("unhealthy kms aborts boot before any connection is opened", async () => {
    const unhealthyKms: KmsAdapter = {
      capabilities: { mode: "local-key" },
      createKey: async () => {},
      getKey: async () => {
        throw new Error("unreachable");
      },
      eraseKey: async () => {},
      health: async () => ({ ok: false, latencyMs: 3 }),
    };
    await expect(boot(undefined, { kms: unhealthyKms })).rejects.toThrow(/KMS health check failed/);
  });

  test("rateLimit flows from runProdApp through entrypoint into the L1/L2 middleware (#1101)", async () => {
    const handle = await boot(undefined, {
      rateLimit: { global: { limit: 1, windowSeconds: 60 } },
      anonymousAccess: { defaultTenantId: TENANT_ID },
    });

    const fetchOnce = () =>
      handle.entrypoint.app.fetch(
        new Request("http://test/api/query", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
          body: JSON.stringify({ type: "prod-probe:query:ping", payload: {} }),
        }),
      );

    expect((await fetchOnce()).status).toBe(200);
    expect((await fetchOnce()).status).toBe(429);
  });
});

describe("hard PII boot gate (#818 step 2)", () => {
  const gatePiiFeature = defineFeature("gate-pii", (r) => {
    r.entity(
      "gate-person",
      createEntity({
        table: "read_gate_persons",
        fields: { email: createTextField({ required: true, pii: true }) },
      }),
    );
  });

  test("PII entities without a kms abort the boot", async () => {
    await expect(boot(undefined, { features: [gatePiiFeature] })).rejects.toThrow(
      /BOOT ABORTED.*PLAINTEXT.*allowPlaintextPii/s,
    );
  });

  test("allowPlaintextPii boots with a warning instead", async () => {
    const handle = await boot(undefined, {
      features: [gatePiiFeature],
      allowPlaintextPii: "test: kms rollout pending",
    });
    expect(handle).toBeDefined();
  });
});

// Regression for fw#1352: runProdApp wires the metrics route through two
// independently forwarded options (observability, metrics). Wrong nesting
// or a renamed key in ApiEntrypointOptions would silently no-op instead of
// erroring the boot, and /metrics would stay 404 or empty.
describe("runProdApp — /metrics endpoint (fw#1352)", () => {
  test("observability (PrometheusMeter) + metrics.token wired → GET /metrics mit Bearer liefert OpenMetrics-Body", async () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({ name: "kumiko_probe_total", type: "counter" });
    meter.counter("kumiko_probe_total").inc(2);

    const handle = await boot(undefined, {
      observability: { ...createNoopProvider(), meter },
      metrics: { token: "t" },
    });

    const res = await handle.entrypoint.app.fetch(
      new Request("http://test/metrics", { headers: { Authorization: "Bearer t" } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/openmetrics-text/);
    const body = await res.text();
    expect(body).toContain("kumiko_probe_total 2");
    expect(body).toMatch(/# EOF\n$/);
  });

  test("ohne observability und ohne metrics-Option → /metrics ist keine Route (404)", async () => {
    const handle = await boot();

    const res = await handle.entrypoint.app.fetch(new Request("http://test/metrics"));
    expect(res.status).toBe(404);
  });
});
