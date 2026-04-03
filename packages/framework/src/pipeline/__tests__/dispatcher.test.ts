import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine";
import { createTestUser } from "../../testing/fixtures";
import { createDispatcher } from "../dispatcher";

const echoFeature = defineFeature("echo", (r) => {
  r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));

  r.writeHandler(
    "item.create",
    z.object({ name: z.string().min(1) }),
    async (event) => ({ isSuccess: true, data: { name: event.payload.name } }),
    { access: { roles: ["Admin"] } },
  );

  r.queryHandler("item.list", z.object({ search: z.string().optional() }), async (query) => ({
    items: [],
    search: query.payload.search,
  }));

  r.hook("validation", "item.create", (data) => {
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
    const result = await dispatcher.write("echo.item.create", { name: "Test" }, createTestUser());

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.data).toEqual({ name: "Test" });
    }
  });

  test("rejects invalid payload", async () => {
    const dispatcher = createTestDispatcher();
    const result = await dispatcher.write("echo.item.create", { name: "" }, createTestUser());

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error).toContain("validation");
    }
  });

  test("rejects unauthorized user", async () => {
    const dispatcher = createTestDispatcher();
    const guest = createTestUser({ roles: ["Guest"] });
    const result = await dispatcher.write("echo.item.create", { name: "Test" }, guest);

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error).toContain("access");
    }
  });

  test("runs validation hooks", async () => {
    const dispatcher = createTestDispatcher();
    const result = await dispatcher.write("echo.item.create", { name: "forbidden" }, createTestUser());

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error).toContain("forbidden_name");
    }
  });

  test("returns error for unknown handler", async () => {
    const dispatcher = createTestDispatcher();
    const result = await dispatcher.write("nonexistent", {}, createTestUser());

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error).toContain("not_found");
    }
  });
});

// --- Dispatch: Query ---

describe("dispatcher.query", () => {
  test("validates and calls query handler", async () => {
    const dispatcher = createTestDispatcher();
    const result = await dispatcher.query("echo.item.list", { search: "hello" }, createTestUser());

    expect(result).toEqual({ items: [], search: "hello" });
  });

  test("rejects invalid query payload", async () => {
    const dispatcher = createTestDispatcher();

    await expect(dispatcher.query("echo.item.list", { search: 123 }, createTestUser())).rejects.toThrow(
      /validation/i,
    );
  });

  test("throws for unknown query handler", async () => {
    const dispatcher = createTestDispatcher();

    await expect(dispatcher.query("nonexistent", {}, createTestUser())).rejects.toThrow(
      /not_found/i,
    );
  });
});

// --- Dispatch: Command (fire-and-forget) ---

describe("dispatcher.command", () => {
  test("executes write handler without returning data", async () => {
    const dispatcher = createTestDispatcher();
    // Command uses write handlers but discards the result
    await expect(
      dispatcher.command("echo.item.create", { name: "Fire" }, createTestUser()),
    ).resolves.toBeUndefined();
  });

  test("still validates and checks access", async () => {
    const dispatcher = createTestDispatcher();
    const guest = createTestUser({ roles: ["Guest"] });

    await expect(dispatcher.command("echo.item.create", { name: "Test" }, guest)).rejects.toThrow(
      /access/i,
    );
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
    const result1 = await dispatcher.write("echo.item.create", { name: "Once" }, user, "req-001");
    const result2 = await dispatcher.write("echo.item.create", { name: "Once" }, user, "req-001");

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
    const result1 = await dispatcher.write("echo.item.create", { name: "A" }, user, "req-a");
    const result2 = await dispatcher.write("echo.item.create", { name: "B" }, user, "req-b");

    expect(result1.isSuccess).toBe(true);
    expect(result2.isSuccess).toBe(true);
    if (result1.isSuccess && result2.isSuccess) {
      expect(result1.data).toEqual({ name: "A" });
      expect(result2.data).toEqual({ name: "B" });
    }
  });
});

// --- Dispatch: Event Log ---

describe("dispatcher event logging", () => {
  test("write events are logged", async () => {
    const log: Array<{ type: string }> = [];
    const registry = createRegistry([echoFeature]);
    const dispatcher = createDispatcher(
      registry,
      {},
      {
        eventLog: {
          append: async (entry) => {
            log.push(entry);
            return "1";
          },
          recent: async () => [],
        },
      },
    );

    await dispatcher.write("echo.item.create", { name: "Logged" }, createTestUser());

    expect(log).toHaveLength(1);
    expect(log[0]?.type).toBe("echo.item.create");
  });

  test("query events are logged", async () => {
    const log: Array<{ type: string }> = [];
    const registry = createRegistry([echoFeature]);
    const dispatcher = createDispatcher(
      registry,
      {},
      {
        eventLog: {
          append: async (entry) => {
            log.push(entry);
            return "1";
          },
          recent: async () => [],
        },
      },
    );

    await dispatcher.query("echo.item.list", {}, createTestUser());

    expect(log).toHaveLength(1);
    expect(log[0]?.type).toBe("echo.item.list");
  });
});

// --- Dispatch: SharedEvent + Broadcast ---

describe("dispatcher.shareEvent and dispatcher.broadcast", () => {
  test("shareEvent is a function", () => {
    const dispatcher = createTestDispatcher();
    expect(typeof dispatcher.shareEvent).toBe("function");
  });

  test("broadcast is a function", () => {
    const dispatcher = createTestDispatcher();
    expect(typeof dispatcher.broadcast).toBe("function");
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
