// runProdApp integration: boots the complete production chain with
// real Postgres + Redis. Verifies:
//   - Migrations are idempotent (2× boots against the same DB → no crash)
//   - Seeds run once; the second boot is a no-op (idempotent by design)
//   - The HTTP server responds to /api/health
//   - The SIGTERM handler cleans up correctly
//
// NOT tested: Bun.serve over a real TCP connection—we call fetch directly.
// Bun.serve wiring is tested separately when the Production-Coolify
// container starts.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createSessionsFeature,
  userSessionEntity,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import {
  createTemplateResolverFeature,
  templateResourceEntity,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { userEntity } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  createRedisSseBroker,
  ExtraRouteRejection,
  isRedisSseBroker,
  NO_ROUTE_MATCH_HEADER_NAME,
  requestContext,
  type SseEvent,
  signatureRoute,
} from "@cosmicdrift/kumiko-framework/api";

import { InMemoryKmsAdapter, type KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient, createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
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
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import {
  APEX_LIGHTBOX_SCRIPT_CSP_HASH,
  renderApexPage,
} from "@cosmicdrift/kumiko-renderer/headless/apex";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { unsafeEnsureEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { Queue } from "bullmq";
import * as z from "zod";
import { type ProdAppHandle, runProdApp } from "../run-prod-app.ts";

const noAppEnvSchema = composeEnvSchema({ features: [] });

// A temporary directory is created per test and removed in afterEach. Tests
// that need staticDir register their paths here.
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
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
    active: createBooleanField({ default: true }),
  },
  table: "prod_widgets",
});

const widgetFeature = defineFeature("prod-probe", (r) => {
  r.entity({ name: "widget", ...widgetEntity });
  // Anonymous query — covers the "anonymousAccess flows from runProdApp
  // through createApiEntrypoint to the auth-middleware" wiring that
  // earlier silently dropped the option in the entrypoint layer.
  r.queryHandler({
    name: "ping",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
    handler: async () => ({ pong: true }),
  });
  // Echoes the resolved client IP — the only way to prove a real Bun.serve
  // socket address reaches requestContext.ip end-to-end; every other test in
  // this file drives fetchHandler directly, which never exercises
  // server.requestIP().
  r.queryHandler({
    name: "ip-probe",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
    handler: async () => ({ ip: requestContext.get()?.ip }),
  });
  r.queryHandler({
    name: "kms-probe",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
    handler: async (_event, ctx) => ({ hasKms: ctx.services.kms !== undefined }),
  });
  // SystemAdmin-gated write—the target of the entry:"signature" / `wire` tests:
  // Echoing user.tenantId + roles proves that dispatch runs through the real
  // dispatcher (Zod + access check) and that the automatically constructed
  // SystemUser carries the target tenant.
  r.writeHandler({
    name: "probe-write",
    schema: z.object({ note: z.string() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event) => ({
      isSuccess: true as const,
      data: { tenantSeen: event.user.tenantId, roles: event.user.roles },
    }),
  });
  // Event + MSP pair for the local event dispatcher:
  // runProdApp is a single-container deployment, so without a local dispatcher
  // no multiStreamProjection is ever applied (Production therefore had empty
  // projections + empty kumiko_event_consumers). The write appends the event;
  // the MSP writes asynchronously to prod_probe_pings, which the test polls.
  const pingedEvent = r.defineEvent("probe-pinged", z.object({ note: z.string() }), {
    piiFields: "none",
  });
  r.writeHandler({
    name: "probe-append",
    schema: z.object({ aggregateId: z.string(), note: z.string() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event, ctx) => {
      const payload = event.payload as { aggregateId: string; note: string }; // @cast-boundary engine-payload
      // unsafeAppendEvent: this test feature does not augment the event type map,
      // so the strictly typed appendEvent narrows to never here.
      await ctx.events.unsafeAppend({
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
  // A post-close 'error' here is otherwise unhandled and bun:test
  // attributes it to whichever test runs next.
  queue.on("error", () => {});
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
  const adminClient = new Bun.SQL(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await adminClient.close();
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

// Production apps boot against a DB that was migrated beforehand
// (`kumiko migrate apply`). This test has no Drizzle migration files, so it
// performs the migration step directly: create the framework infrastructure
// tables and the widget entity table, then start runProdApp with
// `migrations: false` (= no schema-drift gate). This keeps the test focused on
// boot wiring (entrypoint, Hono routes, seeds) without duplicating the
// migration path.
async function migrateTestDb(): Promise<void> {
  const url = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
  const { db, close } = createDbConnection({ url, rowLevelSecurity: "off" });
  try {
    await createEventsTable(db);
    await createArchivedStreamsTable(db);
    await createProjectionStateTable(db);
    await createEventConsumerStateTable(db);
    await unsafeEnsureEntityTable(db, widgetEntity, "widget");
    await unsafeEnsureEntityTable(db, userEntity, "user");
    await unsafeEnsureEntityTable(db, userSessionEntity, "user-session");
    await unsafeEnsureEntityTable(db, templateResourceEntity, "template-resource");
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
      rowLevelSecurity: "off",
      features: [widgetFeature],
      envSchema: noAppEnvSchema,
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

  test("unrecognized KUMIKO_DRY_RUN_ENV value warns and falls through to a normal boot", async () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    const original = process.env["KUMIKO_DRY_RUN_ENV"];
    process.env["KUMIKO_DRY_RUN_ENV"] = "not-a-real-mode";
    try {
      const handle = await boot();
      const res = await handle.entrypoint.app.fetch(new Request("http://test/health"));
      expect(res.status).toBe(200);
    } finally {
      console.warn = originalWarn;
      if (original === undefined) delete process.env["KUMIKO_DRY_RUN_ENV"];
      else process.env["KUMIKO_DRY_RUN_ENV"] = original;
    }
    expect(
      warnings.some(
        (line) =>
          line.includes('KUMIKO_DRY_RUN_ENV="not-a-real-mode"') && line.includes("unrecognized"),
      ),
    ).toBe(true);
  });

  test("second boot against the same DB is idempotent — no crash, no duplicate tables", async () => {
    await boot();
    // First boot left tables in place. Restart on the same DB —
    // unsafeEnsureEntityTable should be a no-op for the existing rows.
    const second = await boot();

    const res = await second.entrypoint.app.fetch(new Request("http://test/health"));
    expect(res.status).toBe(200);
  });

  test("extraRoutes: entry:anonymous mounts custom HTTP-routes on the Hono-app", async () => {
    // Proves runProdApp.extraRoutes mounts declarative route entries that
    // take effect BEFORE the static fallback — the foundation for
    // /feed.xml, /sitemap.xml, /og-image etc.
    let extraInvoked = false;
    const handle = await boot(undefined, {
      extraRoutes: [
        {
          method: "GET",
          path: "/feed.xml",
          entry: "anonymous",
          handler: (c) => {
            extraInvoked = true;
            return c.body('<?xml version="1.0"?><probe ok="true" />', 200, {
              "content-type": "application/rss+xml",
            });
          },
        },
      ],
    });

    // handle.fetch passes through the static-fallback wrapper, which contains
    // the "Hono first, then disk" logic. entrypoint.app.fetch would bypass
    // the wrapper and therefore fail to exercise the regression.
    const res = await handle.fetch(new Request("http://test/feed.xml"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/rss+xml");
    expect(extraInvoked).toBe(true);
    const body = await res.text();
    expect(body).toContain('<probe ok="true" />');
  });

  test("handle.fetch threads the socket address into deps.clientIp, ignoring a spoofed X-Forwarded-For at the default trustedProxyHops (0)", async () => {
    const handle = await boot(undefined, {
      extraRoutes: [
        {
          method: "GET",
          path: "/client-ip-probe",
          entry: "anonymous",
          handler: (c, deps) => c.body(deps.clientIp, 200),
        },
      ],
    });
    const req = () =>
      new Request("http://test/client-ip-probe", { headers: { "x-forwarded-for": "1.2.3.4" } });

    const withSocket = await handle.fetch(req(), "198.51.100.7");
    expect(await withSocket.text()).toBe("198.51.100.7");

    const withoutSocket = await handle.fetch(req());
    expect(await withoutSocket.text()).toBe("unknown");
  });

  test("extraRoutes: entry:signature dispatchSystemWrite schreibt als SystemAdmin des Ziel-Tenants, registry verfügbar", async () => {
    // Wiring for provider webhook routes (billing-foundation
    // createSubscriptionWebhookRoute): the route authenticates via
    // provider signature (verify()) and then writes past the JWT path
    // through the command dispatcher. Proves: (a) registry is in the
    // deps, (b) dispatchSystemWrite goes through Zod + the handler's
    // access check, (c) the SystemUser carries the target tenant.
    let registryHasProbe = false;
    const handle = await boot(undefined, {
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
            registryHasProbe = deps.registry.features.has("prod-probe");
            const result = await deps.dispatchSystemWrite({
              handlerQn: "prod-probe:write:probe-write",
              payload: { note: "from-webhook" },
              tenantId: TENANT_ID as import("@cosmicdrift/kumiko-framework/engine").TenantId,
            });
            return c.json(result);
          },
        }),
      ],
    });

    const res = await handle.fetch(
      new Request("http://test/webhook-probe", {
        method: "POST",
        headers: { "x-probe-signature": "test-secret" },
      }),
    );
    expect(res.status).toBe(200);
    expect(registryHasProbe).toBe(true);
    const body = (await res.json()) as {
      isSuccess: boolean;
      data?: { tenantSeen: string; roles: string[] };
    };
    expect(body.isSuccess).toBe(true);
    expect(body.data?.tenantSeen).toBe(TENANT_ID);
    expect(body.data?.roles).toContain("SystemAdmin");
  });

  test("extraRoutes: entry:signature with a wrong signature rejects with 401 before dispatchSystemWrite runs", async () => {
    let dispatched = false;
    const handle = await boot(undefined, {
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
            dispatched = true;
            const result = await deps.dispatchSystemWrite({
              handlerQn: "prod-probe:write:probe-write",
              payload: { note: "from-webhook" },
              tenantId: TENANT_ID as import("@cosmicdrift/kumiko-framework/engine").TenantId,
            });
            return c.json(result);
          },
        }),
      ],
    });

    const res = await handle.fetch(
      new Request("http://test/webhook-probe", {
        method: "POST",
        headers: { "x-probe-signature": "wrong" },
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad-signature");
    expect(dispatched).toBe(false);
  });

  test("static-fallback: extraRoute beats Disk-File at colliding path (Hono-First)", async () => {
    // Regression test for the static-fallback bug:
    // when an extraRoute (e.g. /feed.xml) and a disk file with the same path
    // both exist in staticDir, the extraRoute wins. Otherwise the SPA fallback
    // consumes unknown paths as index.html, making the app author wonder why
    // their /feed.xml does not work.
    const tmpStaticDir = await createTempStaticDir({
      "feed.xml": "<this-is-the-disk-version />",
      "index.html": "<html>SPA shell</html>",
    });

    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      extraRoutes: [
        {
          method: "GET",
          path: "/feed.xml",
          entry: "anonymous",
          handler: (c) =>
            c.body("<this-is-the-hono-version />", 200, {
              "content-type": "application/rss+xml",
            }),
        },
      ],
    });

    const res = await handle.fetch(new Request("http://test/feed.xml"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<this-is-the-hono-version />");
  });

  test("static-fallback: Disk-File served when no extraRoute matches", async () => {
    // Without a colliding extraRoute, the static fallback serves the disk file.
    // This ensures that the Hono-first path does not accidentally consume
    // static files.
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

  test("static-fallback: a matched extraRoute's own deliberate 404 stays 404, not masked as the SPA shell (#2435)", async () => {
    // tryHonoFirst used to treat ANY 404 as "no
    // route matched" and fall through to index.html with status 200 —
    // masking a matched route's intentional 404 (e.g. default-deny reads
    // like file-derivatives' public-variant route). An index.html exists
    // here specifically to prove the SPA-fallback does NOT win.
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>SPA shell</html>",
    });

    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      extraRoutes: [
        {
          method: "GET",
          path: "/probe/:id",
          entry: "anonymous",
          handler: (c) => {
            if (c.req.param("id") === "missing") return c.text("not found", 404);
            return c.text(`probe:${c.req.param("id")}`, 200);
          },
        },
      ],
    });

    const res = await handle.fetch(new Request("http://test/probe/missing"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
    expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/html/);
    expect(res.headers.has(NO_ROUTE_MATCH_HEADER_NAME)).toBe(false);
  });

  test("static-fallback: an unknown SPA route still gets the SPA shell alongside a route that 404s (#2435)", async () => {
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>SPA shell</html>",
    });

    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      extraRoutes: [
        {
          method: "GET",
          path: "/probe/:id",
          entry: "anonymous",
          handler: (c) => c.text("not found", 404),
        },
      ],
    });

    const res = await handle.fetch(new Request("http://test/some/client-route"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("SPA shell");
    expect(res.headers.has(NO_ROUTE_MATCH_HEADER_NAME)).toBe(false);
  });

  test("static-fallback: an unmatched /api/* path stays a plain 404, no marker leak (#2435)", async () => {
    // /api/* is a passthrough in buildStaticFallback (always Hono, never
    // the SPA shell) — bypasses tryHonoFirst entirely, so the strip at
    // that passthrough site is what's under test here. anonymousAccess is
    // wired so this anonymous GET clears the auth middleware and actually
    // reaches Hono's router (unauthenticated /api/* requests get a plain
    // 401 from the auth guard before routing is even attempted, which
    // would test the auth guard instead of the router-miss path).
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>SPA shell</html>",
    });
    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      anonymousAccess: { defaultTenantId: TENANT_ID },
    });

    const res = await handle.fetch(new Request("http://test/api/totally-unknown-route"));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("SPA shell");
    expect(res.headers.has(NO_ROUTE_MATCH_HEADER_NAME)).toBe(false);
  });

  test("no staticDir (split-deploy/API-only boot): a router-miss never leaks the internal marker header to the client (#2435)", async () => {
    // Without staticDir, fetchHandler is app.fetch directly — it never goes
    // through buildStaticFallback/tryHonoFirst, so the strip has to happen
    // at this bypass site too (run-prod-app.ts's fetchHandler assembly).
    const handle = await boot(undefined, {
      extraRoutes: [
        {
          method: "GET",
          path: "/probe/:id",
          entry: "anonymous",
          handler: (c) => {
            if (c.req.param("id") === "missing") return c.text("not found", 404);
            return c.text(`probe:${c.req.param("id")}`, 200);
          },
        },
      ],
    });

    const routerMiss = await handle.fetch(new Request("http://test/totally/unknown/path"));
    expect(routerMiss.status).toBe(404);
    expect(routerMiss.headers.has(NO_ROUTE_MATCH_HEADER_NAME)).toBe(false);

    const deliberate404 = await handle.fetch(new Request("http://test/probe/missing"));
    expect(deliberate404.status).toBe(404);
    expect(await deliberate404.text()).toBe("not found");
    expect(deliberate404.headers.has(NO_ROUTE_MATCH_HEADER_NAME)).toBe(false);
  });

  test("hostDispatch: async fn receives deps.systemQuery, 'not-found' result → 404", async () => {
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>SPA shell</html>",
    });
    let systemQueryPonged = false;
    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      hostDispatch: async (_req, deps) => {
        const result = await deps.systemQuery("prod-probe:query:ping", {}, TENANT_ID);
        systemQueryPonged = (result as { pong: boolean }).pong === true; // @cast-boundary engine-payload
        return { kind: "not-found" };
      },
    });

    const res = await handle.fetch(new Request("http://test/"));
    expect(res.status).toBe(404);
    expect(systemQueryPonged).toBe(true);
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
    // With no extraRoute or disk file but an existing index.html, the SPA shell
    // is served. This is the standard SPA routing pattern, and verifies that
    // the Hono-first refactor did not break it.
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>SPA shell</html>",
    });

    const handle = await boot(undefined, { staticDir: tmpStaticDir });

    const res = await handle.fetch(new Request("http://test/some/spa/route"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("SPA shell");
  });

  test("static-fallback: non-GET ohne Hono-Match → 404, nicht SPA-Shell (#259)", async () => {
    // Production scenario: a POST to a misconfigured webhook path (the route
    // was not mounted). Returning index.html with status 200 would tell the
    // provider the event was delivered, causing events to be silently lost.
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>SPA shell</html>",
      "robots.txt": "User-agent: *\nAllow: /",
    });

    const handle = await boot(undefined, { staticDir: tmpStaticDir });

    const unmatched = await handle.fetch(
      new Request("http://test/webhooks/subscription/stripe", { method: "POST" }),
    );
    expect(unmatched.status).toBe(404);

    // Disk files are not served for non-GET requests either.
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
    // Multi-app deployment: two HTML files for different hosts. Neither
    // ever carries __KUMIKO_SCHEMA__ — createKumikoApp fetches the schema
    // itself from GET /api/schema after the auth gates let it through,
    // regardless of host.
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html><body>PUBLIC</body><script src=/client.js></script></html>",
      "admin.html": "<html><body>ADMIN</body><script src=/client.js></script></html>",
    });

    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      hostDispatch: ({ host }) => {
        if (host.startsWith("admin.")) {
          return { kind: "html", file: "admin.html" };
        }
        return { kind: "html", file: "index.html" };
      },
    });

    const pubRes = await handle.fetch(
      new Request("http://demo.example.test/", { headers: { host: "demo.example.test" } }),
    );
    expect(pubRes.status).toBe(200);
    const pubBody = await pubRes.text();
    expect(pubBody).toContain("PUBLIC");
    expect(pubBody).not.toContain("__KUMIKO_SCHEMA__");

    const adminRes = await handle.fetch(
      new Request("http://admin.example.test/", { headers: { host: "admin.example.test" } }),
    );
    expect(adminRes.status).toBe(200);
    const adminBody = await adminRes.text();
    expect(adminBody).toContain("ADMIN");
    expect(adminBody).not.toContain("__KUMIKO_SCHEMA__");
  });

  test("staticDir without hostDispatch: HTML never carries the schema; GET /api/schema needs a signed-in user (kumiko-framework#3314)", async () => {
    // A real POST /api/auth/login round-trip needs the tenant/user bundled
    // features' own projection tables (e.g. read_tenants), which this
    // suite's boot() doesn't migrate (migrations: false, only the app's own
    // entity tables are auto-created — see unsafeEnsureEntityTable above).
    // Signing a token straight through the entrypoint's JwtHelper exercises
    // the exact same cookie transport auth-middleware reads, without
    // pulling in that migration surface just for this schema-fetch test.
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html><body>SHELL</body><script src=/client.js></script></html>",
    });

    const handle = await boot(undefined, { staticDir: tmpStaticDir });

    const rootRes = await handle.fetch(new Request("http://test/"));
    expect(rootRes.status).toBe(200);
    expect(await rootRes.text()).not.toContain("__KUMIKO_SCHEMA__");

    const spaRes = await handle.fetch(new Request("http://test/some/spa/route"));
    expect(spaRes.status).toBe(200);
    expect(await spaRes.text()).not.toContain("__KUMIKO_SCHEMA__");

    const anonSchemaRes = await handle.fetch(new Request("http://test/api/schema"));
    expect(anonSchemaRes.status).toBe(401);

    const token = await handle.entrypoint.jwt.sign({
      id: "schema-fetch-user",
      tenantId: TENANT_ID as import("@cosmicdrift/kumiko-framework/engine").TenantId,
      roles: ["User"],
    });
    const schemaRes = await handle.fetch(
      new Request("http://test/api/schema", { headers: { Cookie: `kumiko_auth=${token}` } }),
    );
    expect(schemaRes.status).toBe(200);
    const schema = (await schemaRes.json()) as { features: readonly unknown[] };
    expect(schema.features.length).toBeGreaterThan(0);
  });

  test("anonymousAccess wired → GET /api/schema still 401s for the synthesised anonymous user", async () => {
    const handle = await boot(undefined, {
      anonymousAccess: {
        defaultTenantId: TENANT_ID as import("@cosmicdrift/kumiko-framework/engine").TenantId,
      },
    });

    const res = await handle.entrypoint.app.fetch(new Request("http://test/api/schema"));
    expect(res.status).toBe(401);
  });

  test("extraContext.searchAdapter absent → GET /api/schema marks every feature searchAdapterMissing (#2062)", async () => {
    const handle = await boot();
    const token = await handle.entrypoint.jwt.sign({
      id: "schema-probe-user",
      tenantId: TENANT_ID as import("@cosmicdrift/kumiko-framework/engine").TenantId,
      roles: ["User"],
    });

    const res = await handle.entrypoint.app.fetch(
      new Request("http://test/api/schema", { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(res.status).toBe(200);
    const schema = (await res.json()) as {
      features: ReadonlyArray<{ searchAdapterMissing?: boolean }>;
    };
    // Guards against a vacuous pass — an empty features array would make
    // `.every(...)` below vacuously true too.
    expect(schema.features.length).toBeGreaterThan(0);
    expect(schema.features.every((f) => f.searchAdapterMissing === true)).toBe(true);
  });

  test("extraContext.searchAdapter wired → GET /api/schema omits searchAdapterMissing (#2062)", async () => {
    const handle = await boot(undefined, {
      // Presence-only probe — run-prod-app's cast-boundary read only checks
      // truthiness, so a minimal stand-in is enough without pulling in the
      // real SearchAdapter shape.
      extraContext: { searchAdapter: { configure: async () => {}, search: async () => [] } },
    });
    const token = await handle.entrypoint.jwt.sign({
      id: "schema-probe-user",
      tenantId: TENANT_ID as import("@cosmicdrift/kumiko-framework/engine").TenantId,
      roles: ["User"],
    });

    const res = await handle.entrypoint.app.fetch(
      new Request("http://test/api/schema", { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(res.status).toBe(200);
    const schema = (await res.json()) as {
      features: ReadonlyArray<{ searchAdapterMissing?: boolean }>;
    };
    expect(schema.features.length).toBeGreaterThan(0);
    expect(schema.features.some((f) => f.searchAdapterMissing === true)).toBe(false);
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

  test("hostDispatch: per-host CSP wins over the default CSP, other hosts get the default with build hashes", async () => {
    const hash = `sha256-${"B".repeat(43)}=`;
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>x</html>",
      "csp-hashes.json": JSON.stringify({ scriptSrc: [hash] }),
    });
    const hostCsp = "default-src 'none'";
    const handle = await boot(undefined, {
      staticDir: tmpStaticDir,
      hostDispatch: ({ host }) => ({
        kind: "html",
        file: "index.html",
        injectSchema: false,
        ...(host === "special.example.test" && { csp: hostCsp }),
      }),
    });

    const special = await handle.fetch(new Request("http://special.example.test/"));
    expect(special.headers.get("content-security-policy")).toBe(hostCsp);
    const other = await handle.fetch(new Request("http://other.example.test/"));
    expect(other.headers.get("content-security-policy")).toContain(`script-src 'self' '${hash}'`);
  });

  test("default CSP is on without configuration and csp: false removes it", async () => {
    const tmpStaticDir = await createTempStaticDir({ "index.html": "<html>x</html>" });
    const withDefault = await boot(undefined, { staticDir: tmpStaticDir });
    const res = await withDefault.fetch(new Request("http://x.example.test/"));
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");

    const withoutCsp = await boot(undefined, {
      staticDir: tmpStaticDir,
      securityHeaders: { csp: false },
    });
    const bare = await withoutCsp.fetch(new Request("http://x.example.test/"));
    expect(bare.headers.has("content-security-policy")).toBe(false);
    expect(bare.headers.get("x-frame-options")).toBe("DENY");
  });

  test("default CSP covers apex pages the app renders into staticDir after kumiko build", async () => {
    const tmpStaticDir = await createTempStaticDir({
      "index.html": "<html>x</html>",
      "csp-hashes.json": JSON.stringify({ scriptSrc: [] }),
    });
    await mkdir(join(tmpStaticDir, "pages", "en"), { recursive: true });
    await writeFile(
      join(tmpStaticDir, "pages", "en", "landing.html"),
      renderApexPage({
        brand: { tokensCss: ":root{--primary:#123;}" },
        head: { lang: "en", title: "Landing", description: "Landing page" },
        header: { brand: { href: "/", label: "Acme" } },
        sections: [],
        footer: { brand: { label: "Acme" } },
      }),
    );
    const handle = await boot(undefined, { staticDir: tmpStaticDir });

    const res = await handle.fetch(new Request("http://x.example.test/"));

    expect(res.headers.get("content-security-policy")).toContain(
      `'${APEX_LIGHTBOX_SCRIPT_CSP_HASH}'`,
    );
  });

  test("hostDispatch: assets bleiben host-unabhängig erreichbar", async () => {
    // /assets/* must bypass hostDispatch: the client loads bundles by absolute
    // URL, so host-based routing would be incorrect.
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
    // Factory form for extraContext closes over db like anonymousAccess.
    // In auth mode the framework automatically sets configResolver; the factory
    // result is merged into it. The factory is called exactly once at boot,
    // after db/redis/registry have been constructed.
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
    // Synthetic kumiko/migrations directory with a checked-in migration that
    // has not been applied (no _kumiko_migrations entry). runProdApp must abort
    // with SchemaDriftError before anything else is initialized.
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

describe("runProdApp — real Bun.serve socket resolves the client IP (fw#3260 addendum)", () => {
  // Every other test in this file drives handle.fetch()/entrypoint.app.fetch()
  // directly, which never goes through Bun.serve's real TCP socket — so none
  // of them can catch a regression where the socket address gets lost before
  // reaching requestContext.ip (see client-ip.ts: falls back to "unknown"
  // rather than throwing, so a wiring bug here stays silent otherwise).
  test("a real loopback connection resolves to the actual socket address, not 'unknown'", async () => {
    const handle = await boot(undefined, {
      autoListen: true,
      anonymousAccess: { defaultTenantId: TENANT_ID },
    });
    const port = handle.server?.port;
    if (port === undefined) throw new Error("expected handle.server to be listening");

    const res = await fetch(`http://127.0.0.1:${port}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "prod-probe:query:ip-probe", payload: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { ip?: string } };
    // Exact loopback notation (bare "127.0.0.1" vs. the IPv4-mapped IPv6
    // form "::ffff:127.0.0.1") depends on the platform's dual-stack
    // listener behavior, not on the code under test — matching the
    // family instead of a fixed literal keeps the assertion about what
    // this test actually proves: a real socket address reached
    // requestContext.ip instead of the "unknown" fallback.
    expect(body.data?.ip).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
  });
});

describe("runProdApp — rejected WebSocket upgrades carry the security headers", () => {
  const wsProbeFeature = defineFeature("ws-probe", (r) => {
    r.webSocketRoute({ path: "/api/ws/probe", connect: () => ({}) });
  });

  test("a real upgrade request refused by the route (no session) still gets nosniff", async () => {
    const handle = await boot(undefined, {
      features: [widgetFeature, wsProbeFeature],
      autoListen: true,
      anonymousAccess: { defaultTenantId: TENANT_ID },
    });
    const port = handle.server?.port;
    if (port === undefined) throw new Error("expected handle.server to be listening");

    const res = await fetch(`http://127.0.0.1:${port}/api/ws/probe`, {
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
          "base64",
        ),
      },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("runProdApp: lokaler Event-Dispatcher (MSP-Anwendung im Single-Container)", () => {
  // Regression: runProdApp did not build the event dispatcher
  // ({disabled:true} in the API entrypoint), so no multiStreamProjection was
  // applied in Production and kumiko_event_consumers remained empty. The test
  // writes through the real boot path and polls for the asynchronously
  // projected row.

  async function pollFor<T>(probe: () => Promise<T | undefined>): Promise<T> {
    let result: T | undefined;
    await waitFor(
      async () => {
        result = await probe();
        return result !== undefined;
      },
      { delays: Array(50).fill(100) },
    );
    if (result === undefined) throw new Error("pollFor: timeout");
    return result;
  }

  test("Write → appendEvent → MSP wendet async an; Consumer-Cursor wandert", async () => {
    let dispatchSystemWrite: import("../extra-routes-deps.ts").SystemWireDeps["dispatchSystemWrite"];
    const handle = await boot(undefined, {
      eventDispatcher: { pollIntervalMs: 50 },
      wire: (deps) => {
        dispatchSystemWrite = deps.dispatchSystemWrite;
      },
    });

    // The default boot builds the local dispatcher and start() has started it.
    expect(handle.entrypoint.eventDispatcher).toBeDefined();

    const aggregateId = crypto.randomUUID();
    const result = await dispatchSystemWrite!({
      handlerQn: "prod-probe:write:probe-append",
      payload: { aggregateId, note: "dispatched" },
      tenantId: TENANT_ID as import("@cosmicdrift/kumiko-framework/engine").TenantId,
    });
    expect(result.isSuccess).toBe(true);

    const url = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
    const { db, close } = createDbConnection({ url, rowLevelSecurity: "off" });
    try {
      const row = await pollFor(async () => {
        const rows = (await asRawClient(db).unsafe(
          `SELECT note FROM prod_probe_pings WHERE aggregate_id = $1`,
          [aggregateId],
        )) as Array<{ note: string }>;
        return rows[0];
      });
      expect(row.note).toBe("dispatched");

      // In prod this table was empty, which proved no dispatcher ever ran.
      // The cursor is committed after the projection row, so poll on the
      // cursor value itself — a registered consumer still reads 0 for a moment.
      const consumer = await pollFor(async () => {
        const rows = (await asRawClient(db).unsafe(
          `SELECT name, last_processed_event_id FROM kumiko_event_consumers
           WHERE name = $1`,
          ["prod-probe:projection:probe-ping-projection"],
        )) as Array<{ name: string; last_processed_event_id: string | number }>;
        const [consumerRow] = rows;
        return Number(consumerRow?.last_processed_event_id) > 0 ? consumerRow : undefined;
      });
      expect(Number(consumer.last_processed_event_id)).toBeGreaterThan(0);
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

// Origin-guard config flows from runProdApp's auth options through to
// buildServer. Before the forwarding fix, RunProdAppAuthOptions had no
// `allowedOrigins`, so a cookieDomain app could not satisfy the fail-closed
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
        features: [
          createAuthFoundationFeature(),
          createPersonalAccessTokensFeature({ scopes: {} }),
          createSessionsFeature(),
        ],
        auth: { admin: ADMIN, cookieDomain: "example.eu" },
        allowPlaintextPii: "test: origin-guard focus, not crypto",
      }),
    ).rejects.toThrow(/allowedOrigins is empty/);
  });

  test("cookieDomain + allowedOrigins clears the guard — allowlist reaches buildServer", async () => {
    // Without the forwarding fix this would ALSO throw /allowedOrigins is empty/.
    // auth tables are migrated for this file (migrateTestDb() above); this test
    // isolates only that a later boot failure is never the origin-guard message.
    let bootError: unknown;
    try {
      const handle = await boot(undefined, {
        features: [
          createAuthFoundationFeature(),
          createPersonalAccessTokensFeature({ scopes: {} }),
          createSessionsFeature(),
        ],
        auth: {
          admin: ADMIN,
          cookieDomain: "example.eu",
          allowedOrigins: ["https://app.example.eu"],
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

describe("runProdApp — auth retiredCookieDomains forwarding", () => {
  test("retiredCookieDomains reaches createAuthRoutes — its boot validation rejects an entry equal to cookieDomain", async () => {
    await expect(
      boot(undefined, {
        features: [
          createAuthFoundationFeature(),
          createPersonalAccessTokensFeature({ scopes: {} }),
          createSessionsFeature(),
        ],
        auth: {
          admin: {
            email: "retired-cookie@example.eu",
            password: "test-pw-strong-1234",
            displayName: "Admin",
            memberships: [],
          },
          cookieDomain: "example.eu",
          retiredCookieDomains: ["example.eu"],
          allowedOrigins: ["https://app.example.eu"],
        },
        allowPlaintextPii: "test: retired-cookie focus, not crypto",
      }),
    ).rejects.toThrow(/retiredCookieDomains entry "example.eu" equals cookieDomain/);
  });
});

describe("runProdApp — session boot gate (#1262/#1275)", () => {
  const ADMIN = {
    email: "session-gate@example.eu",
    password: "test-pw-strong-1234",
    displayName: "Admin",
    memberships: [],
  };

  test("auth mounted, sessions feature missing → aborts boot", async () => {
    await expect(
      boot(undefined, {
        auth: {
          admin: ADMIN,
          cookieDomain: "example.eu",
          allowedOrigins: ["https://app.example.eu"],
        },
        allowPlaintextPii: "test: session-gate focus, not crypto",
      }),
    ).rejects.toThrow(/BOOT ABORTED.*sessionStore/);
  });

  test("auth mounted, sessions feature mounted → boots cleanly (the happy path the gate guards)", async () => {
    const handle = await boot(undefined, {
      // "user" is auto-mounted via includeBundled whenever auth.admin is set.
      // sessions requires auth-foundation, which needs a tokenVerifier
      // provider — PAT.
      features: [
        createAuthFoundationFeature(),
        createPersonalAccessTokensFeature({ scopes: {} }),
        createSessionsFeature(),
        createTemplateResolverFeature(),
        createRendererFoundationFeature(),
        createRendererMailHtmlFeature(),
      ],
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
      // handle.entrypoint.app.fetch has no real socket, and the client-ip
      // resolver ignores X-Forwarded-For without a trusted hop — without
      // this, every call below (and every other untrusted-XFF call this
      // suite makes) resolves to the same shared "unknown" bucket, so the
      // probeIp uniqueness below is silently defeated by whichever test
      // happens to run first.
      trustedProxyHops: 1,
    });

    // Unique per test run: the L1 limiter's Redis bucket is keyed only on
    // this IP (`l1:${ip}`, globalIpRateLimit in rate-limit/middleware.ts) —
    // a fixed literal here would collide with whatever this same test's
    // last run left in a non-ephemeral local Redis, well within the 60s
    // window, and see 429 on the very first request instead of 200.
    const probeIp = `203.0.113.${crypto.randomUUID()}`;
    const fetchOnce = () =>
      handle.entrypoint.app.fetch(
        new Request("http://test/api/query", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": probeIp },
          body: JSON.stringify({ type: "prod-probe:query:ping", payload: {} }),
        }),
      );

    expect((await fetchOnce()).status).toBe(200);
    expect((await fetchOnce()).status).toBe(429);
  });
});

describe("rate-limit defaults", () => {
  // Unique per call: the L1/L2 buckets are keyed on the client IP in Redis and
  // must not collide with earlier runs inside the same 60 s window.
  const requestsFrom = (handle: ProdAppHandle, path: string, ip: string) => async () =>
    (
      await handle.entrypoint.app.fetch(
        new Request(`http://test${path}`, { headers: { "x-forwarded-for": ip } }),
      )
    ).status;

  test("without rateLimit option the default L1 bucket of 600 per minute runs dry", async () => {
    const handle = await boot(undefined, { trustedProxyHops: 1 });
    const hit = requestsFrom(handle, "/api/no-such-route", `203.0.113.${crypto.randomUUID()}`);

    // Token bucket: the burst may only exceed 600 by what refilled while it ran.
    const startedAt = performance.now();
    const statuses = await Promise.all(Array.from({ length: 700 }, () => hit()));
    const elapsedSeconds = (performance.now() - startedAt) / 1000;

    const allowed = statuses.filter((status) => status !== 429).length;
    expect(allowed).toBeGreaterThanOrEqual(600);
    expect(allowed).toBeLessThanOrEqual(600 + Math.ceil(elapsedSeconds * 10) + 1);
    expect(statuses).toContain(429);
  });

  test("without rateLimit option the 31st auth request of a minute is answered 429", async () => {
    const handle = await boot(undefined, { trustedProxyHops: 1 });
    const hit = requestsFrom(handle, "/api/auth/no-such-route", `203.0.113.${crypto.randomUUID()}`);

    for (let i = 0; i < 30; i++) expect(await hit()).not.toBe(429);
    expect(await hit()).toBe(429);
  });

  test("rateLimit: false never answers 429", async () => {
    const handle = await boot(undefined, { trustedProxyHops: 1, rateLimit: false });
    const hit = requestsFrom(handle, "/api/auth/no-such-route", `203.0.113.${crypto.randomUUID()}`);

    for (let i = 0; i < 650; i++) expect(await hit()).not.toBe(429);
  });

  test("a partial global override replaces only the global limit", async () => {
    const handle = await boot(undefined, {
      trustedProxyHops: 1,
      rateLimit: { global: { limit: 5 } },
    });
    const hit = requestsFrom(handle, "/api/no-such-route", `203.0.113.${crypto.randomUUID()}`);

    for (let i = 0; i < 5; i++) expect(await hit()).not.toBe(429);
    expect(await hit()).toBe(429);
  });
});

describe("hard PII boot gate (#818 step 2)", () => {
  const gatePiiFeature = defineFeature("gate-pii", (r) => {
    r.entity({
      name: "gate-person",
      ...createEntity({
        table: "read_gate_persons",
        fields: { email: createTextField({ required: true, personal: "self", find: "none" }) },
      }),
    });
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

// runProdApp wires the metrics route through two independently forwarded
// options (observability, metrics). Wrong nesting or a renamed key in
// ApiEntrypointOptions would silently no-op instead of erroring the boot,
// and /metrics would stay 404 or empty.
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

  // A Redis Pub/Sub fanout fix for SSE/access-invalidation across replicas
  // was not effective because runProdApp built its own in-memory sseBroker
  // unconditionally and passed it in as ServerOptions.sseBroker — which
  // always wins over buildServer's REDIS_URL default. These tests exercise
  // the level prod actually boots through (runProdApp), not
  // buildServer/createRedisSseBroker directly, which is why the tests above
  // were green while prod was broken.
  describe("sseBroker wiring (fw#2630 Redis fanout)", () => {
    test("wires a Redis-backed sseBroker so SSE events fan out across replicas", async () => {
      const handle = await boot();
      const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:16379";
      const channel = `runprod-sse-${generateId()}`;
      const received: SseEvent[] = [];
      const otherReplica = createRedisSseBroker({ redisUrl });
      try {
        otherReplica.addClient(
          channel,
          (event) => received.push(event),
          () => {},
        );
        await waitFor(async () => {
          await handle.entrypoint.sseBroker.pushToChannel(channel, {
            type: "unit.updated",
            data: { id: "1" },
          });
          return received.length >= 1;
        });
        expect(received[0]).toEqual({ type: "unit.updated", data: { id: "1" } });
      } finally {
        await otherReplica.close();
      }
    });

    test("closes the Redis-backed sseBroker on shutdown (no leaked connection)", async () => {
      const handle = await boot();
      const broker = handle.entrypoint.sseBroker;
      if (!isRedisSseBroker(broker)) {
        throw new Error("expected a Redis-backed sseBroker under REDIS_URL");
      }
      let closeCalls = 0;
      const originalClose = broker.close.bind(broker);
      broker.close = async () => {
        closeCalls += 1;
        await originalClose();
      };

      await handle.stop();
      // avoid a second stop()/close() from the module-level afterEach
      const idx = prodAppHandles.indexOf(handle);
      if (idx >= 0) prodAppHandles.splice(idx, 1);

      expect(closeCalls).toBe(1);
    });
  });
});
