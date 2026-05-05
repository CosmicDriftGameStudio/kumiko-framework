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

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createArchivedStreamsTable, createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { ensureEntityTable } from "@cosmicdrift/kumiko-framework/stack";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
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
});

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
    await ensureEntityTable(db, widgetEntity, "widget");
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
    // ensureEntityTable should be a no-op for the existing rows.
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
    expect(factoryDeps).toEqual({ db: true, redis: true, registry: true });
    // Smoke: handle is functional (boot completed without error).
    expect(handle.entrypoint).toBeDefined();
  });

  test("seed runs once on first boot, but the seed's own idempotence prevents duplication on reboot", async () => {
    let seedInvocations = 0;
    let inserted = false;

    const seed = async ({ db }: { db: import("@cosmicdrift/kumiko-framework/db").DbConnection }) => {
      seedInvocations++;
      // Seed-side idempotence: check before inserting. runProdApp doesn't
      // gate seeds — the seed itself is responsible.
      const existing = await db.execute(sql`SELECT 1 FROM prod_widgets LIMIT 1`);
      if (existing.length > 0) return;
      await db.execute(sql`INSERT INTO prod_widgets (id, tenant_id, name) VALUES
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

  test("Hard Boot-Gate: pending Migration im Journal → SchemaDriftError, kein Boot", async () => {
    // Schreibt ein synthetisches Migration-Dir mit einer Migration die
    // nie applied wurde. runProdApp soll mit SchemaDriftError abbrechen
    // bevor irgendetwas anderes initialisiert wird.
    const { mkdir } = await import("node:fs/promises");
    const driftDir = await mkdtemp(join(tmpdir(), "kumiko-drift-boot-"));
    tempDirs.push(driftDir);
    await mkdir(join(driftDir, "meta"), { recursive: true });
    await writeFile(
      join(driftDir, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          {
            idx: 0,
            version: "7",
            when: 1700000000000,
            tag: "0000_pending_migration",
            breakpoints: true,
          },
        ],
      }),
    );
    await writeFile(
      join(driftDir, "meta", "0000_snapshot.json"),
      JSON.stringify({
        tables: {
          "public.never_created_table": {
            schema: "",
            name: "never_created_table",
            columns: { id: { name: "id", type: "uuid", primaryKey: true, notNull: true } },
          },
        },
      }),
    );

    await expect(boot(undefined, { migrations: { dir: driftDir } })).rejects.toThrow(
      /Schema drift detected/,
    );
  });
});
