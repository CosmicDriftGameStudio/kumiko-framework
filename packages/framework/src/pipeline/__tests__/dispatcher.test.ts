import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import type { TenantId } from "../../engine/types/identifiers";
import { createTestUser } from "../../stack";
import { createDispatcher } from "../dispatcher";

const echoFeature = defineFeature("echo", (r) => {
  r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));

  r.writeHandler(
    "item:create",
    z.object({ name: z.string().min(1) }),
    async (event) => ({ isSuccess: true, data: { name: event.payload.name } }),
    { access: { roles: ["Admin"] } },
  );

  r.queryHandler(
    "item:list",
    z.object({ search: z.string().optional() }),
    async (query) => ({
      items: [],
      search: query.payload.search,
    }),
    { access: { openToAll: true } },
  );

  r.hook("validation", "item:create", (data) => {
    if (data["name"] === "forbidden") return [{ field: "name", error: "forbidden_name" }];
    return null;
  });
});

function createTestDispatcher() {
  const registry = createRegistry([echoFeature]);
  return createDispatcher(registry, {});
}

// --- Dispatch: Write ---

describe("dispatcher.write", () => {
  test("validates payload and calls handler", async () => {
    const dispatcher = createTestDispatcher();
    const result = await dispatcher.write(
      "echo:write:item:create",
      { name: "Test" },
      createTestUser(),
    );

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.data).toEqual({ name: "Test" });
    }
  });

  test("rejects invalid payload", async () => {
    const dispatcher = createTestDispatcher();
    const result = await dispatcher.write("echo:write:item:create", { name: "" }, createTestUser());

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error.code).toBe("validation_error");
    }
  });

  test("rejects unauthorized user", async () => {
    const dispatcher = createTestDispatcher();
    const guest = createTestUser({ roles: ["Guest"] });
    const result = await dispatcher.write("echo:write:item:create", { name: "Test" }, guest);

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error.code).toBe("access_denied");
    }
  });

  test("ip-bucketed handler with no IP + no resolver skips rate-limit (es-ops seed/job path)", async () => {
    // Regression: the es-ops seed/job dispatcher has no RateLimitResolver. An
    // ip-bucketed handler invoked from there has no client IP to bucket on, so
    // it must SKIP the rate-limit — not throw "no RateLimitResolver is
    // configured". (The HTTP path still has the resolver for real anon writes.)
    const rlFeature = defineFeature("rl", (r) => {
      r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
      r.writeHandler(
        "item:create",
        z.object({ name: z.string() }),
        async (event) => ({ isSuccess: true, data: { name: event.payload.name } }),
        { access: { openToAll: true }, rateLimit: { per: "ip+handler", limit: 3, windowSeconds: 60 } },
      );
    });
    const dispatcher = createDispatcher(createRegistry([rlFeature]), {});
    const result = await dispatcher.write("rl:write:item:create", { name: "seeded" }, createTestUser());
    expect(result.isSuccess).toBe(true);
  });

  test("ctx.user ist Convenience-Alias auf event.user (gleicher Wert)", async () => {
    // Pinst dass der Handler auf ctx.user zugreifen kann ohne den
    // typo-resistenten event.user-Pfad zu nutzen. Identitätsprüfung
    // gegen denselben SessionUser — sonst ist's nicht der gleiche.
    const captured: { fromEvent?: unknown; fromCtx?: unknown } = {};
    const aliasFeature = defineFeature("alias", (r) => {
      r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
      r.writeHandler(
        "item:create",
        z.object({ name: z.string() }),
        async (event, ctx) => {
          captured.fromEvent = event.user;
          captured.fromCtx = ctx.user;
          return { isSuccess: true, data: {} };
        },
        { access: { roles: ["Admin"] } },
      );
    });
    const dispatcher = createDispatcher(createRegistry([aliasFeature]), {});
    const user = createTestUser();
    const res = await dispatcher.write("alias:write:item:create", { name: "x" }, user);
    expect(res.isSuccess).toBe(true);
    expect(captured.fromCtx).toBe(captured.fromEvent);
    expect((captured.fromCtx as { id: unknown }).id).toBe(user.id);
  });

  test("runs validation hooks", async () => {
    const dispatcher = createTestDispatcher();
    const result = await dispatcher.write(
      "echo:write:item:create",
      { name: "forbidden" },
      createTestUser(),
    );

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error.code).toBe("validation_error");
      const fields = (result.error.details as { fields: Array<{ code: string }> }).fields;
      expect(fields.some((f) => f.code === "forbidden_name")).toBe(true);
    }
  });

  test("returns error for unknown handler", async () => {
    const dispatcher = createTestDispatcher();
    const result = await dispatcher.write("nonexistent", {}, createTestUser());

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error.code).toBe("not_found");
    }
  });
});

// --- Dispatch: Query ---

describe("dispatcher.query", () => {
  test("validates and calls query handler", async () => {
    const dispatcher = createTestDispatcher();
    const result = await dispatcher.query(
      "echo:query:item:list",
      { search: "hello" },
      createTestUser(),
    );

    expect(result).toEqual({ items: [], search: "hello" });
  });

  test("rejects invalid query payload", async () => {
    const dispatcher = createTestDispatcher();

    await expect(
      dispatcher.query("echo:query:item:list", { search: 123 }, createTestUser()),
    ).rejects.toMatchObject({ code: "validation_error", httpStatus: 400 });
  });

  test("throws for unknown query handler", async () => {
    const dispatcher = createTestDispatcher();

    await expect(dispatcher.query("nonexistent", {}, createTestUser())).rejects.toMatchObject({
      code: "not_found",
      httpStatus: 404,
    });
  });
});

// --- postQuery hooks on standalone (entity-less) queries ---

describe("dispatcher.query postQuery hooks", () => {
  test("handler-keyed postQuery hook fires on a standalone (no-colon) query", async () => {
    // Standalone queries (name without colon, e.g. "dashboard") map to no
    // entity. Handler-keyed postQuery hooks must still fire — gating the hook
    // pass on entity-existence makes such a hook register silently + never run.
    const feature = defineFeature("dash", (r) => {
      r.queryHandler("dashboard", z.object({}), async () => ({ count: 1 }), {
        access: { openToAll: true },
      });
      r.hook("postQuery", "dashboard", async ({ entityName, rows }) => {
        expect(entityName).toBeUndefined();
        return { rows: rows.map((row) => ({ ...row, enriched: true })) };
      });
    });

    const dispatcher = createDispatcher(createRegistry([feature]), {});
    const result = await dispatcher.query("dash:query:dashboard", {}, createTestUser());
    expect(result).toEqual({ count: 1, enriched: true });
  });

  test("postQuery hook does not run for a result with rows:null (not an array)", async () => {
    // `{ rows: null }` is a legitimate 'nothing found' shape — it must take the
    // single-object branch, not the rows-list branch (which would crash on
    // [...null]). The hook here returns the row unchanged so the shape survives.
    const feature = defineFeature("nullrows", (r) => {
      r.queryHandler("dashboard", z.object({}), async () => ({ rows: null, nextCursor: null }), {
        access: { openToAll: true },
      });
      r.hook("postQuery", "dashboard", async ({ rows }) => ({ rows }));
    });

    const dispatcher = createDispatcher(createRegistry([feature]), {});
    const result = await dispatcher.query("nullrows:query:dashboard", {}, createTestUser());
    expect(result).toEqual({ rows: null, nextCursor: null });
  });

  test("single-object postQuery hook returning ≠1 row throws", async () => {
    const feature = defineFeature("multi", (r) => {
      r.queryHandler("dashboard", z.object({}), async () => ({ count: 1 }), {
        access: { openToAll: true },
      });
      r.hook("postQuery", "dashboard", async ({ rows }) => ({ rows: [...rows, ...rows] }));
    });

    const dispatcher = createDispatcher(createRegistry([feature]), {});
    await expect(dispatcher.query("multi:query:dashboard", {}, createTestUser())).rejects.toThrow(
      /must return exactly one row, got 2/,
    );
  });
});

// --- Dispatch: Command (fire-and-forget) ---

describe("dispatcher.command", () => {
  test("executes write handler without returning data", async () => {
    const dispatcher = createTestDispatcher();
    // Command uses write handlers but discards the result
    await expect(
      dispatcher.command("echo:write:item:create", { name: "Fire" }, createTestUser()),
    ).resolves.toBeUndefined();
  });

  test("still validates and checks access", async () => {
    const dispatcher = createTestDispatcher();
    const guest = createTestUser({ roles: ["Guest"] });

    await expect(
      dispatcher.command("echo:write:item:create", { name: "Test" }, guest),
    ).rejects.toThrow(/access/i);
  });
});

// --- Dispatch: Idempotency ---

describe("dispatcher.write idempotency", () => {
  test("duplicate requestId returns cached result", async () => {
    const registry = createRegistry([echoFeature]);
    const dispatcher = createDispatcher(
      registry,
      {},
      {
        idempotency: createMockIdempotencyGuard(),
      },
    );

    const user = createTestUser();
    const result1 = await dispatcher.write(
      "echo:write:item:create",
      { name: "Once" },
      user,
      "req-001",
    );
    const result2 = await dispatcher.write(
      "echo:write:item:create",
      { name: "Once" },
      user,
      "req-001",
    );

    expect(result1.isSuccess).toBe(true);
    expect(result2.isSuccess).toBe(true);
    // Same cached result — handler should only have been called once
    if (result1.isSuccess && result2.isSuccess) {
      expect(result2.data).toEqual(result1.data);
    }
  });

  test("different requestIds execute separately", async () => {
    const registry = createRegistry([echoFeature]);
    const dispatcher = createDispatcher(
      registry,
      {},
      {
        idempotency: createMockIdempotencyGuard(),
      },
    );

    const user = createTestUser();
    const result1 = await dispatcher.write("echo:write:item:create", { name: "A" }, user, "req-a");
    const result2 = await dispatcher.write("echo:write:item:create", { name: "B" }, user, "req-b");

    expect(result1.isSuccess).toBe(true);
    expect(result2.isSuccess).toBe(true);
    if (result1.isSuccess && result2.isSuccess) {
      expect(result1.data).toEqual({ name: "A" });
      expect(result2.data).toEqual({ name: "B" });
    }
  });
});

// --- Feature-toggle gate ---

describe("dispatcher feature-gate", () => {
  function toggled() {
    return defineFeature("toggled", (r) => {
      r.toggleable({ default: true });
      r.entity("widget", createEntity({ table: "Widgets", fields: { name: createTextField() } }));
      r.queryHandler("widget:list", z.object({}).passthrough(), async () => ({ items: [] }), {
        access: { openToAll: true },
      });
      r.writeHandler(
        "widget:create",
        z.object({ name: z.string() }),
        async (event) => ({ isSuccess: true, data: { name: event.payload.name } }),
        { access: { roles: ["Admin"] } },
      );
    });
  }

  const user = createTestUser({ id: "u1", roles: ["Admin"] });

  test("query of disabled feature throws FeatureDisabledError", async () => {
    const registry = createRegistry([toggled()]);
    const disabled = new Set<string>();
    const dispatcher = createDispatcher(
      registry,
      {},
      {
        effectiveFeatures: () => {
          const all = new Set(registry.features.keys());
          for (const d of disabled) all.delete(d);
          return all;
        },
      },
    );

    await expect(dispatcher.query("toggled:query:widget:list", {}, user)).resolves.toEqual({
      items: [],
    });

    disabled.add("toggled");
    await expect(dispatcher.query("toggled:query:widget:list", {}, user)).rejects.toThrow(
      /feature toggled is disabled/,
    );

    disabled.delete("toggled");
    await expect(dispatcher.query("toggled:query:widget:list", {}, user)).resolves.toEqual({
      items: [],
    });
  });

  test("write of disabled feature returns WriteFailure with feature_disabled reason", async () => {
    const registry = createRegistry([toggled()]);
    const disabled = new Set<string>(["toggled"]);
    const dispatcher = createDispatcher(
      registry,
      {},
      {
        effectiveFeatures: () => {
          const all = new Set(registry.features.keys());
          for (const d of disabled) all.delete(d);
          return all;
        },
      },
    );

    const result = await dispatcher.write("toggled:write:widget:create", { name: "x" }, user);
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error.code).toBe("feature_disabled");
      expect(result.error.details).toMatchObject({
        reason: "feature_disabled",
        feature: "toggled",
      });
    }
  });

  test("no effectiveFeatures callback → gate is pass-through", async () => {
    const registry = createRegistry([toggled()]);
    const dispatcher = createDispatcher(registry, {});
    await expect(dispatcher.query("toggled:query:widget:list", {}, user)).resolves.toEqual({
      items: [],
    });
  });

  test("trialGate: disabled feature is allowed on the gate's cold path when trialGate returns true", async () => {
    // Beweist die Live-Trial-Mechanik: der sync resolver hat das Feature NICHT
    // im Set (alles disabled), aber checkFeatureEnabled konsultiert den async
    // trialGate auf dem disabled-Pfad. Deckt beide Aufrufstellen ab (query =
    // ensureFeatureEnabled, write = checkFeatureEnabled).
    const registry = createRegistry([toggled()]);
    let trialOpen = false;
    const effectiveFeatures = Object.assign(() => new Set<string>(), {
      trialGate: async (_tenantId: TenantId, feature: string) => trialOpen && feature === "toggled",
    });
    const dispatcher = createDispatcher(registry, {}, { effectiveFeatures });

    // Trial zu → 403 (resolver-Set leer, Gate verweigert).
    await expect(dispatcher.query("toggled:query:widget:list", {}, user)).rejects.toThrow(
      /feature toggled is disabled/,
    );
    const writeClosed = await dispatcher.write("toggled:write:widget:create", { name: "x" }, user);
    expect(writeClosed.isSuccess).toBe(false);
    if (!writeClosed.isSuccess) expect(writeClosed.error.code).toBe("feature_disabled");

    // Trial offen → Gate lässt durch, obwohl der Resolver das Feature nicht
    // führt. Query passiert; Write passiert das Gate (scheitert ggf. später an
    // fehlender DB, aber NICHT mehr an feature_disabled).
    trialOpen = true;
    await expect(dispatcher.query("toggled:query:widget:list", {}, user)).resolves.toEqual({
      items: [],
    });
    const writeOpen = await dispatcher.write("toggled:write:widget:create", { name: "x" }, user);
    if (!writeOpen.isSuccess) expect(writeOpen.error.code).not.toBe("feature_disabled");
  });

  test("Sprint 8a: per-tenant gating — Tenant A passes, Tenant B gets feature_disabled", async () => {
    // Beweist die Phase-1-Architektur: dispatcher ruft effectiveFeatures
    // mit user.tenantId, resolver kann pro Tenant unterschiedliche Sets
    // returnen → Tier-A sieht feature, Tier-B nicht.
    const registry = createRegistry([toggled()]);
    const tenantA = "00000000-0000-4000-8000-0000000000a1" as TenantId;
    const tenantB = "00000000-0000-4000-8000-0000000000b2" as TenantId;

    const dispatcher = createDispatcher(
      registry,
      {},
      {
        effectiveFeatures: (tenantId) => (tenantId === tenantA ? new Set(["toggled"]) : new Set()),
      },
    );

    const userA = createTestUser({ id: "u-a", tenantId: tenantA, roles: ["Admin"] });
    const userB = createTestUser({ id: "u-b", tenantId: tenantB, roles: ["Admin"] });

    await expect(dispatcher.query("toggled:query:widget:list", {}, userA)).resolves.toEqual({
      items: [],
    });
    await expect(dispatcher.query("toggled:query:widget:list", {}, userB)).rejects.toThrow(
      /feature toggled is disabled/,
    );

    const writeA = await dispatcher.write("toggled:write:widget:create", { name: "from-a" }, userA);
    expect(writeA.isSuccess).toBe(true);

    const writeB = await dispatcher.write("toggled:write:widget:create", { name: "from-b" }, userB);
    expect(writeB.isSuccess).toBe(false);
    if (!writeB.isSuccess) {
      expect(writeB.error.code).toBe("feature_disabled");
    }
  });

  test("Sprint 8a: ctx.hasFeature is current-user-scoped", async () => {
    // Pin: hasFeature() in handler-bodies resolves against ctx.user.tenantId,
    // NICHT gegen einen globalen Set. Two tenants call same handler,
    // beide rufen hasFeature("toggled") — A bekommt true, B false.
    const tenantA = "00000000-0000-4000-8000-0000000000a3" as TenantId;
    const tenantB = "00000000-0000-4000-8000-0000000000b4" as TenantId;

    const probe = defineFeature("probe", (r) => {
      r.queryHandler(
        "check",
        z.object({}).passthrough(),
        async (_event, ctx) => ({ enabled: ctx.hasFeature("toggled") }),
        { access: { openToAll: true } },
      );
    });
    const registry = createRegistry([toggled(), probe]);
    const dispatcher = createDispatcher(
      registry,
      {},
      {
        effectiveFeatures: (tenantId) =>
          tenantId === tenantA ? new Set(["toggled", "probe"]) : new Set(["probe"]),
      },
    );

    const userA = createTestUser({ id: "u-a2", tenantId: tenantA, roles: ["Admin"] });
    const userB = createTestUser({ id: "u-b2", tenantId: tenantB, roles: ["Admin"] });

    await expect(dispatcher.query("probe:query:check", {}, userA)).resolves.toEqual({
      enabled: true,
    });
    await expect(dispatcher.query("probe:query:check", {}, userB)).resolves.toEqual({
      enabled: false,
    });
  });
});

describe("write-handler shape guard", () => {
  // Real footgun caught while building the publicstatus showcase: a custom
  // handler that returns `{ id }` instead of `{ isSuccess: true, data: { id } }`
  // used to crash the dispatcher with an obscure "internal error". The
  // shape-guard turns this into a clear actionable message at the
  // dispatcher boundary.

  function brokenFeature() {
    return defineFeature("broken", (r) => {
      r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
      r.writeHandler(
        "item:create",
        z.object({ name: z.string() }),
        // biome-ignore lint/suspicious/noExplicitAny: deliberate wrong-shape return for the test
        async (event) => ({ id: "x", name: event.payload.name }) as any,
        { access: { roles: ["Admin"] } },
      );
    });
  }

  test("handler returning a non-WriteResult shape → InternalError with actionable hint", async () => {
    const registry = createRegistry([brokenFeature()]);
    const dispatcher = createDispatcher(registry, {});
    const result = await dispatcher.write(
      "broken:write:item:create",
      { name: "test" },
      createTestUser(),
    );

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error.code).toBe("internal_error");
      // Message points at defineWriteHandler / WriteResult-shape — that's
      // the developer's actionable next step. Also surfaces in the
      // dev-mode response body via error.message.
      expect(result.error.message).toContain("invalid shape");
      expect(result.error.message).toContain("defineWriteHandler");
    }
  });
});

// --- Mock helpers ---

function createMockIdempotencyGuard() {
  const cache = new Map<string, string>();
  return {
    async check(requestId: string) {
      return cache.get(requestId) ?? null;
    },
    async store(requestId: string, result: unknown) {
      cache.set(requestId, JSON.stringify(result));
    },
  };
}
