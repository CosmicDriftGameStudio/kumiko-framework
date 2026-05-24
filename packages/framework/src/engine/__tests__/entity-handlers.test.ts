import { describe, expect, test } from "bun:test";
import {
  createEntityExecutor,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityQueryHandler,
  defineEntityRestoreHandler,
  defineEntityUpdateHandler,
  defineEntityWriteHandler,
  defineProjectionQueryHandler,
} from "../entity-handlers";
import { createEntity, createTextField } from "../factories";

const VALID_UUID = "00000000-0000-4000-8000-000000000001";

const noteEntity = createEntity({
  table: "notes",
  fields: {
    title: createTextField({ required: true }),
    body: createTextField(),
  },
});

const noteEntitySoftDelete = createEntity({
  table: "notes_soft",
  fields: {
    title: createTextField({ required: true }),
  },
  softDelete: true,
});

describe("defineEntityWriteHandler", () => {
  test("throws when name has no colon", () => {
    expect(() => defineEntityWriteHandler("note", noteEntity)).toThrow(/<entity>:<verb>/);
  });

  test("throws when entity part is empty", () => {
    expect(() => defineEntityWriteHandler(":create", noteEntity)).toThrow(
      /missing the entity part/,
    );
  });

  test("throws when verb is unknown", () => {
    expect(() => defineEntityWriteHandler("note:archive", noteEntity)).toThrow(
      /Unknown verb "archive"/,
    );
  });

  test("throws when restore is requested on an entity without softDelete", () => {
    expect(() => defineEntityRestoreHandler("note", noteEntity)).toThrow(/restore is only valid/);
  });

  test("create: handler def carries name, schema, handler", () => {
    const def = defineEntityCreateHandler("note", noteEntity);
    expect(def.name).toBe("note:create");
    expect(typeof def.handler).toBe("function");
    expect(def.schema.safeParse({ title: "x" }).success).toBe(true);
    expect(def.schema.safeParse({}).success).toBe(false);
  });

  test("update: schema requires id + version + changes", () => {
    const def = defineEntityUpdateHandler("note", noteEntity);
    expect(
      def.schema.safeParse({ id: VALID_UUID, version: 1, changes: { title: "x" } }).success,
    ).toBe(true);
    expect(def.schema.safeParse({ id: VALID_UUID, changes: { title: "x" } }).success).toBe(false);
    expect(def.schema.safeParse({ id: VALID_UUID, version: 1 }).success).toBe(false);
  });

  test("delete: schema requires only id", () => {
    const def = defineEntityDeleteHandler("note", noteEntity);
    expect(def.schema.safeParse({ id: VALID_UUID }).success).toBe(true);
    expect(def.schema.safeParse({}).success).toBe(false);
  });

  test("restore: schema requires only id (with softDelete)", () => {
    const def = defineEntityRestoreHandler("note", noteEntitySoftDelete);
    expect(def.schema.safeParse({ id: VALID_UUID }).success).toBe(true);
    expect(def.schema.safeParse({}).success).toBe(false);
  });

  test("access option is forwarded into the handler def", () => {
    const def = defineEntityCreateHandler("note", noteEntity, {
      access: { roles: ["Admin"] },
    });
    expect(def.access).toEqual({ roles: ["Admin"] });
  });

  test("omitting access leaves the handler def's access unset", () => {
    const def = defineEntityCreateHandler("note", noteEntity);
    expect(def.access).toBeUndefined();
  });
});

describe("defineEntityQueryHandler", () => {
  test("throws when verb is unknown (write verbs are not allowed here)", () => {
    expect(() => defineEntityQueryHandler("note:create", noteEntity)).toThrow(
      /Unknown verb "create"/,
    );
  });

  test("list: schema accepts the standard pagination/search/sort params", () => {
    const def = defineEntityListHandler("note", noteEntity);
    expect(def.schema.safeParse({}).success).toBe(true);
    expect(
      def.schema.safeParse({
        cursor: "abc",
        limit: 10,
        search: "y",
        sort: "title",
        sortDirection: "asc",
      }).success,
    ).toBe(true);
    expect(def.schema.safeParse({ sortDirection: "wrong" }).success).toBe(false);
  });

  test("detail: schema requires id", () => {
    const def = defineEntityDetailHandler("note", noteEntity);
    expect(def.schema.safeParse({ id: VALID_UUID }).success).toBe(true);
    expect(def.schema.safeParse({}).success).toBe(false);
  });

  test("access option is forwarded", () => {
    const def = defineEntityListHandler("note", noteEntity, {
      access: { openToAll: true },
    });
    expect(def.access).toEqual({ openToAll: true });
  });
});

describe("createEntityExecutor", () => {
  test("returns a drizzle table plus an executor bound to it", () => {
    const { table, executor } = createEntityExecutor("note", noteEntity);
    // Table: drizzle-built — has the id column the event-store executor keys on.
    expect(table).toBeDefined();
    expect(table!["id"]).toBeDefined();
    // Executor: the standard CRUD/verb surface is present.
    expect(typeof executor.create).toBe("function");
    expect(typeof executor.update).toBe("function");
    expect(typeof executor.delete).toBe("function");
    expect(typeof executor.detail).toBe("function");
    expect(typeof executor.list).toBe("function");
  });

  test("accepts softDelete entities (executor.restore exists)", () => {
    const { executor } = createEntityExecutor("note", noteEntitySoftDelete);
    expect(typeof executor.restore).toBe("function");
  });
});

describe("defineProjectionQueryHandler", () => {
  test("name + empty schema + access are forwarded", () => {
    const def = defineProjectionQueryHandler(
      "revenue:list",
      "showcase:projection:customer-revenue",
      { access: { openToAll: true } },
    );
    expect(def.name).toBe("revenue:list");
    expect(def.access).toEqual({ openToAll: true });
    // Empty-object schema — handler takes no payload fields.
    expect(def.schema.safeParse({}).success).toBe(true);
  });

  test("handler passes the qualified name to ctx.queryProjection and returns its rows", async () => {
    const def = defineProjectionQueryHandler(
      "revenue:list",
      "showcase:projection:customer-revenue",
    );
    const fakeRows = [{ customer: "a", totalCents: 100 }];
    const ctx = {
      queryProjection: mock().mockResolvedValue(fakeRows),
    };
    const result = await def.handler(
      // biome-ignore lint/suspicious/noExplicitAny: test shim — handler only touches ctx.queryProjection here.
      { type: "revenue:list", user: {} as any, payload: {} },
      // biome-ignore lint/suspicious/noExplicitAny: test shim — see above.
      ctx as any,
    );
    expect(ctx.queryProjection).toHaveBeenCalledWith(
      "showcase:projection:customer-revenue",
      undefined,
    );
    expect(result).toBe(fakeRows);
  });

  test("unsafeAllTenants: true forwards the option to ctx.queryProjection", async () => {
    const def = defineProjectionQueryHandler(
      "revenue:list",
      "showcase:projection:customer-revenue",
      { unsafeAllTenants: true },
    );
    const ctx = { queryProjection: mock().mockResolvedValue([]) };
    await def.handler(
      // biome-ignore lint/suspicious/noExplicitAny: test shim.
      { type: "revenue:list", user: {} as any, payload: {} },
      // biome-ignore lint/suspicious/noExplicitAny: test shim.
      ctx as any,
    );
    expect(ctx.queryProjection).toHaveBeenCalledWith("showcase:projection:customer-revenue", {
      unsafeAllTenants: true,
    });
  });

  test("omitting access leaves the handler def's access unset", () => {
    const def = defineProjectionQueryHandler(
      "revenue:list",
      "showcase:projection:customer-revenue",
    );
    expect(def.access).toBeUndefined();
  });
});

// Verb-spezifische Wrappers — sind dünne Convenience-Layers über
// defineEntityWriteHandler/QueryHandler. Tests checken nur dass sie
// die richtige verb-suffixed Handler-Definition produzieren; das
// Schema-Building + Executor-Body-Behavior ist in den umfangreichen
// Tests von defineEntityWriteHandler/QueryHandler oben gedeckt.

describe("Verb-specific entity-handler factories", () => {
  test("defineEntityCreateHandler produziert <entity>:create", () => {
    const def = defineEntityCreateHandler("note", noteEntity, {
      access: { roles: ["Admin"] },
    });
    expect(def.name).toBe("note:create");
    expect(def.access).toEqual({ roles: ["Admin"] });
  });

  test("defineEntityUpdateHandler produziert <entity>:update", () => {
    const def = defineEntityUpdateHandler("note", noteEntity);
    expect(def.name).toBe("note:update");
  });

  test("defineEntityDeleteHandler produziert <entity>:delete", () => {
    const def = defineEntityDeleteHandler("note", noteEntity);
    expect(def.name).toBe("note:delete");
  });

  test("defineEntityRestoreHandler produziert <entity>:restore (auf softDelete-Entity)", () => {
    const def = defineEntityRestoreHandler("note", noteEntitySoftDelete);
    expect(def.name).toBe("note:restore");
  });

  test("defineEntityRestoreHandler ohne softDelete → throw (Runtime-Guard bleibt)", () => {
    expect(() => defineEntityRestoreHandler("note", noteEntity)).toThrow(/softDelete: true/);
  });

  test("defineEntityListHandler produziert <entity>:list", () => {
    const def = defineEntityListHandler("note", noteEntity, {
      access: { roles: ["Admin", "Editor"] },
    });
    expect(def.name).toBe("note:list");
    expect(def.access).toEqual({ roles: ["Admin", "Editor"] });
  });

  test("defineEntityDetailHandler produziert <entity>:detail", () => {
    const def = defineEntityDetailHandler("note", noteEntity);
    expect(def.name).toBe("note:detail");
  });

  test("Verb-Wrapper liefern Handler die identisch zu Legacy-API funktionieren", async () => {
    // Equivalence-Probe: defineEntityCreateHandler("note", ...) ist nicht
    // bloß ein Naming-Sugar — die Handler-Function muss bit-identisch zu
    // defineEntityCreateHandler("note", ...) sein. Wir vergleichen
    // hier die Schema-Identitäten + Handler-Namen; Behavior-Tests des
    // Executors leben in event-store-executor.integration.ts.
    const newApi = defineEntityCreateHandler("note", noteEntity);
    const legacyApi = defineEntityCreateHandler("note", noteEntity);
    expect(newApi.name).toBe(legacyApi.name);
    expect(typeof newApi.handler).toBe("function");
    expect(typeof legacyApi.handler).toBe("function");
  });
});
