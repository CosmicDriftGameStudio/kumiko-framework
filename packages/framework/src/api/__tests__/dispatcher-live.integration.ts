import { createLiveDispatcher } from "@kumiko/dispatcher-live";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { createEntityTable, setupTestStack, type TestStack, TestUsers } from "../../testing";

// End-to-end: UI code would call `dispatcher.write("feat:write:item:create", ...)`.
// This test wires dispatcher-live against the real Kumiko HTTP stack via
// Hono's `app.request()` (in-memory, no port) and proves the whole path:
//   dispatcher-live → JSON body + headers → Hono route → dispatcher →
//   write-handler → crud-executor → DB → response → dispatcher-live →
//   typed WriteResult.
//
// Server-side CSRF middleware is enabled by the normal server config, so
// the dispatcher must carry X-CSRF-Token correctly or these writes would
// land as 403. The test proves that wiring end-to-end.

const itemEntity = createEntity({
  table: "dispatcher_live_items",
  fields: { name: createTextField({ required: true }) },
});
const itemTable = buildDrizzleTable("item", itemEntity);

const itemFeature = defineFeature("dlive", (r) => {
  r.entity("item", itemEntity);

  r.writeHandler(
    "item:create",
    z.object({ name: z.string().min(1) }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(itemTable, itemEntity, { entityName: "item" });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  r.queryHandler(
    "item:list",
    z.object({}).optional(),
    async (_event, ctx) => {
      return ctx.db.select().from(itemTable);
    },
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

// Wire dispatcher-live's `fetch` to Hono's in-memory `app.request`. Also
// synthesizes the auth + CSRF cookies a real browser would send: the stack
// exposes the Hono app, but the normal login-flow-based session-cookie
// setup isn't in play here — we sign a JWT directly and set both the
// `kumiko_auth` (HttpOnly JWT) and `kumiko_csrf` cookies by hand. A
// real browser login does the same server-side via auth-routes.ts.
//
// The fetch wrapper echoes the csrf cookie back into the X-CSRF-Token
// header — that's the real dispatcher-live code path; the test just
// stages the cookies first.
async function buildFetch(): Promise<{
  readonly fetch: typeof fetch;
  readonly csrfToken: string;
  readonly authJwt: string;
}> {
  const authJwt = await stack.jwt.sign(admin);
  const csrfToken = globalThis.crypto.randomUUID();
  const cookieHeader = `kumiko_auth=${authJwt}; kumiko_csrf=${csrfToken}`;

  // Cast via unknown: the native fetch interface (Bun's typing) includes a
  // `preconnect` method we don't need and can't meaningfully implement
  // against Hono's in-memory request handler. dispatcher-live calls the
  // functional shape only — preconnect is a hint, not load-bearing.
  const fetchImpl = (async (url: unknown, init: RequestInit | undefined) => {
    const reqInit: RequestInit = {
      ...(init ?? {}),
      headers: {
        ...(init?.headers ?? {}),
        Cookie: cookieHeader,
      },
    };
    return stack.app.request(String(url), reqInit);
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, csrfToken, authJwt };
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [itemFeature] });
  await createEntityTable(stack.db.db, itemEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.db.delete(itemTable);
});

describe("dispatcher-live (integration) — full path against Kumiko server", () => {
  test("write: dispatches HTTP, server persists, response maps to typed WriteResult", async () => {
    const { fetch, csrfToken } = await buildFetch();
    const dispatcher = createLiveDispatcher({
      fetch,
      readCsrf: () => csrfToken,
    });

    const result = await dispatcher.write<{ data?: { name?: string } }>("dlive:write:item:create", {
      name: "hello-live",
    });

    expect(result.isSuccess).toBe(true);

    // Prove the server actually persisted.
    const rows = await stack.db.db.select().from(itemTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["name"]).toBe("hello-live");
  });

  test("write: validation failure surfaces as typed DispatcherError with field issues", async () => {
    const { fetch, csrfToken } = await buildFetch();
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => csrfToken });

    const result = await dispatcher.write("dlive:write:item:create", { name: "" });

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error.code).toBe("validation_error");
      const fieldPaths = (result.error.details?.fields ?? []).map((f) => f.path);
      expect(fieldPaths).toContain("name");
    }
  });

  test("missing CSRF token: server rejects — exercises Vorarbeit-A wiring", async () => {
    const { fetch } = await buildFetch();
    // Dispatcher with no csrf reader — the header won't be sent.
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => undefined });

    const result = await dispatcher.write("dlive:write:item:create", { name: "no-csrf" });

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      // The CSRF middleware raises with code "csrf_token_mismatch".
      expect(result.error.code).toBe("csrf_token_mismatch");
    }
  });

  test("query: dispatches GET-style-POST (Kumiko uses POST for query too), returns data", async () => {
    // Seed a row first.
    await stack.db.db.insert(itemTable).values({
      id: globalThis.crypto.randomUUID(),
      tenantId: admin.tenantId,
      name: "seed",
    });

    const { fetch, csrfToken } = await buildFetch();
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => csrfToken });

    const result = await dispatcher.query<unknown[]>("dlive:query:item:list", {});

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toHaveLength(1);
    }
  });

  test("batch: multiple writes go through one HTTP call, atomic on the server", async () => {
    const { fetch, csrfToken } = await buildFetch();
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => csrfToken });

    const result = await dispatcher.batch([
      { type: "dlive:write:item:create", payload: { name: "a" } },
      { type: "dlive:write:item:create", payload: { name: "b" } },
      { type: "dlive:write:item:create", payload: { name: "c" } },
    ]);

    expect(result.isSuccess).toBe(true);

    const rows = await stack.db.db.select().from(itemTable);
    expect(rows).toHaveLength(3);
    const names = rows.map((r) => r["name"]).sort();
    expect(names).toEqual(["a", "b", "c"]);
  });

  test("batch: mid-batch failure rolls back the prior writes — atomic guarantee preserved", async () => {
    const { fetch, csrfToken } = await buildFetch();
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => csrfToken });

    const result = await dispatcher.batch([
      { type: "dlive:write:item:create", payload: { name: "ok-1" } },
      { type: "dlive:write:item:create", payload: { name: "" } }, // fails validation
      { type: "dlive:write:item:create", payload: { name: "never-runs" } },
    ]);

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.failedIndex).toBe(1);
    }

    // DB must be empty — prior success within a failed batch rolls back.
    const rows = await stack.db.db.select().from(itemTable);
    expect(rows).toHaveLength(0);
  });
});
