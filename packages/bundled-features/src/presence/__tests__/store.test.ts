import { describe, expect, test } from "bun:test";
import type { Redis } from "ioredis";
import { createMemoryPresenceStore, createRedisPresenceStore } from "../store.ts";

const TTL_MS = 45_000;
const KEY = "presence:tenant:doc:1";
const warnings: string[] = [];
const log = {
  warn: (message: string) => {
    warnings.push(message);
  },
} as Parameters<typeof createRedisPresenceStore>[1]; // test double: the store only warns

function redisDouble(status: string, failWith?: Error): Redis {
  const fail = async () => {
    throw failWith;
  };
  const chain = { hset: () => chain, expire: () => chain, exec: fail };
  return {
    status,
    hget: failWith ? fail : async () => null,
    hgetall: failWith ? fail : async () => ({}),
    hdel: failWith ? fail : async () => 0,
    multi: () => chain,
  } as unknown as Redis; // test double: only the commands the store uses
}

describe("memory store", () => {
  test("touch reports a change for a new entry and none for a keep-alive", async () => {
    const store = createMemoryPresenceStore();
    const state = { activity: "viewing", focus: "field:a" } as const;
    expect((await store.touch(KEY, "u1", state, 1000, TTL_MS)).changed).toBe(true);
    expect((await store.touch(KEY, "u1", state, 2000, TTL_MS)).changed).toBe(false);
    expect((await store.touch(KEY, "u1", { activity: "editing" }, 3000, TTL_MS)).changed).toBe(
      true,
    );
  });

  test("an expired entry is dropped on read and counts as new on the next touch", async () => {
    const store = createMemoryPresenceStore();
    await store.touch(KEY, "u1", { activity: "viewing" }, 1000, TTL_MS);
    expect(await store.list(KEY, 1000 + TTL_MS, TTL_MS)).toHaveLength(1);
    expect(await store.list(KEY, 1001 + TTL_MS, TTL_MS)).toEqual([]);
    const again = await store.touch(KEY, "u1", { activity: "viewing" }, 1002 + TTL_MS, TTL_MS);
    expect(again.changed).toBe(true);
  });

  test("remove tells whether an entry existed", async () => {
    const store = createMemoryPresenceStore();
    await store.touch(KEY, "u1", { activity: "viewing" }, 1000, TTL_MS);
    expect((await store.remove(KEY, "u1")).existed).toBe(true);
    expect((await store.remove(KEY, "u1")).existed).toBe(false);
  });
});

describe("redis store without a usable connection", () => {
  test("a connection that is not ready behaves like an empty room and never throws", async () => {
    warnings.length = 0;
    const store = createRedisPresenceStore(redisDouble("connecting"), log);
    expect(await store.touch(KEY, "u1", { activity: "viewing" }, 1000, TTL_MS)).toEqual({
      changed: false,
    });
    expect(await store.list(KEY, 1000, TTL_MS)).toEqual([]);
    expect(await store.remove(KEY, "u1")).toEqual({ existed: false });
    expect(warnings).toHaveLength(3);
  });

  test("a throwing command is logged and answered with the empty result", async () => {
    warnings.length = 0;
    const store = createRedisPresenceStore(redisDouble("ready", new Error("boom")), log);
    expect(await store.list(KEY, 1000, TTL_MS)).toEqual([]);
    expect(await store.touch(KEY, "u1", { activity: "viewing" }, 1000, TTL_MS)).toEqual({
      changed: false,
    });
    expect(warnings).toHaveLength(2);
  });
});

describe("memory store sweep", () => {
  test("an abandoned room is dropped by a later touch elsewhere once a ttl has passed", async () => {
    const store = createMemoryPresenceStore();
    await store.touch("presence:t:doc:A", "u1", { activity: "viewing" }, 100_000, TTL_MS);
    expect(store.roomCount()).toBe(1);
    await store.touch(
      "presence:t:doc:B",
      "u2",
      { activity: "viewing" },
      100_000 + TTL_MS + 1,
      TTL_MS,
    );
    expect(store.roomCount()).toBe(1);
    expect(await store.list("presence:t:doc:A", 100_000 + TTL_MS + 1, TTL_MS)).toEqual([]);
  });
});
