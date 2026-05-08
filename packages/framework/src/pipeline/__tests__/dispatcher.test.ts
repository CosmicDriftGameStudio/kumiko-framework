import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
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
    expect((captured.fromCtx as { id: number }).id).toBe(user.id);
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

  test("Sprint 8a: per-tenant gating — Tenant A passes, Tenant B gets feature_disabled", async () => {
    // Beweist die Phase-1-Architektur: dispatcher ruft effectiveFeatures
    // mit user.tenantId, resolver kann pro Tenant unterschiedliche Sets
    // returnen → Tier-A sieht feature, Tier-B nicht.
    const registry = createRegistry([toggled()]);
    const tenantA = "00000000-0000-4000-8000-0000000000a1" as import(
      "../../engine/types/identifiers"
    ).TenantId;
    const tenantB = "00000000-0000-4000-8000-0000000000b2" as import(
      "../../engine/types/identifiers"
    ).TenantId;

    const dispatcher = createDispatcher(
      registry,
      {},
      {
        effectiveFeatures: (tenantId) =>
          tenantId === tenantA ? new Set(["toggled"]) : new Set(),
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

    const writeA = await dispatcher.write(
      "toggled:write:widget:create",
      { name: "from-a" },
      userA,
    );
    expect(writeA.isSuccess).toBe(true);

    const writeB = await dispatcher.write(
      "toggled:write:widget:create",
      { name: "from-b" },
      userB,
    );
    expect(writeB.isSuccess).toBe(false);
    if (!writeB.isSuccess) {
      expect(writeB.error.code).toBe("feature_disabled");
    }
  });

  test("Sprint 8a: ctx.hasFeature is current-user-scoped", async () => {
    // Pin: hasFeature() in handler-bodies resolves against ctx.user.tenantId,
    // NICHT gegen einen globalen Set. Two tenants call same handler,
    // beide rufen hasFeature("toggled") — A bekommt true, B false.
    const tenantA = "00000000-0000-4000-8000-0000000000a3" as import(
      "../../engine/types/identifiers"
    ).TenantId;
    const tenantB = "00000000-0000-4000-8000-0000000000b4" as import(
      "../../engine/types/identifiers"
    ).TenantId;

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
          tenantId === tenantA
            ? new Set(["toggled", "probe"])
            : new Set(["probe"]),
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
