import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  type PipelineUser,
} from "../../engine";
import { createDispatcher } from "../dispatcher";

function createTestUser(overrides?: Partial<PipelineUser>): PipelineUser {
  return { id: 1, tenantId: 1, roles: ["Admin"], ...overrides };
}

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
    const result = await dispatcher.write("item.create", { name: "Test" }, createTestUser());

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.data).toEqual({ name: "Test" });
    }
  });

  test("rejects invalid payload", async () => {
    const dispatcher = createTestDispatcher();
    const result = await dispatcher.write("item.create", { name: "" }, createTestUser());

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error).toContain("validation");
    }
  });

  test("rejects unauthorized user", async () => {
    const dispatcher = createTestDispatcher();
    const guest = createTestUser({ roles: ["Guest"] });
    const result = await dispatcher.write("item.create", { name: "Test" }, guest);

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error).toContain("access");
    }
  });

  test("runs validation hooks", async () => {
    const dispatcher = createTestDispatcher();
    const result = await dispatcher.write("item.create", { name: "forbidden" }, createTestUser());

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
    const result = await dispatcher.query("item.list", { search: "hello" }, createTestUser());

    expect(result).toEqual({ items: [], search: "hello" });
  });

  test("rejects invalid query payload", async () => {
    const dispatcher = createTestDispatcher();

    await expect(dispatcher.query("item.list", { search: 123 }, createTestUser())).rejects.toThrow(
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
      dispatcher.command("item.create", { name: "Fire" }, createTestUser()),
    ).resolves.toBeUndefined();
  });

  test("still validates and checks access", async () => {
    const dispatcher = createTestDispatcher();
    const guest = createTestUser({ roles: ["Guest"] });

    await expect(dispatcher.command("item.create", { name: "Test" }, guest)).rejects.toThrow(
      /access/i,
    );
  });
});
