import { describe, expect, test } from "bun:test";
import { runEventStoreSeed } from "../entity-seed";

describe("runEventStoreSeed", () => {
  test('default ifExists="skip" returns existing id without update', async () => {
    let updateCalls = 0;
    let createCalls = 0;

    const result = await runEventStoreSeed<string>({
      existing: { id: "agg-1", version: 3 },
      create: async () => {
        createCalls++;
        return { id: "new" };
      },
      update: async () => {
        updateCalls++;
        return { id: "agg-1" };
      },
    });

    expect(result.id).toBe("agg-1");
    expect(updateCalls).toBe(0);
    expect(createCalls).toBe(0);
  });

  test('ifExists="update" calls update when row exists', async () => {
    let updateCalls = 0;

    const result = await runEventStoreSeed<string>({
      existing: { id: "agg-2", version: 1 },
      ifExists: "update",
      create: async () => ({ id: "new" }),
      update: async (existing) => {
        updateCalls++;
        expect(existing.version).toBe(1);
        return { id: existing.id };
      },
    });

    expect(result.id).toBe("agg-2");
    expect(updateCalls).toBe(1);
  });

  test("missing row calls create", async () => {
    let createCalls = 0;

    const result = await runEventStoreSeed<string>({
      existing: null,
      create: async () => {
        createCalls++;
        return { id: "created" };
      },
      update: async () => ({ id: "never" }),
    });

    expect(result.id).toBe("created");
    expect(createCalls).toBe(1);
  });

  test("supports numeric id type via explicit generic", async () => {
    const result = await runEventStoreSeed<number>({
      existing: { id: 42, version: 1 },
      ifExists: "update",
      create: async () => ({ id: 99 }),
      update: async (row) => ({ id: row.id }),
    });

    expect(result.id).toBe(42);
  });
});
