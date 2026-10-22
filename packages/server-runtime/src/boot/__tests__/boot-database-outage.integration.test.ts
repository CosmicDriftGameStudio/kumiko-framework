import { afterAll, describe, expect, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Redis } from "ioredis";
import { runWorkerApp } from "../../run-worker-app.ts";
import { applyStandardBootSeeds } from "../shared-boot-steps.ts";
import { WAIT_FOR_DATABASE_DEADLINE_MS } from "../wait-for-database.ts";

function fakeClock() {
  let clock = 0;
  const sleeps: number[] = [];
  const logs: string[] = [];
  return {
    sleeps,
    logs,
    clock: {
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
      log: (line: string) => logs.push(line),
    },
  };
}

function pgError(code: string): Error {
  return Object.assign(new Error(`failure ${code}`), { code });
}

async function unusedLocalPort(): Promise<number> {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = listener;
  listener.stop(true);
  return port;
}

function redisUrl(): string {
  return process.env["REDIS_URL"] ?? "redis://localhost:16379";
}

describe("worker boot against an unreachable database", () => {
  test("retries until the deadline, aborts with the last connection error and closes its Redis clients", async () => {
    const probe = new Redis(redisUrl());
    const countClients = async (): Promise<number> =>
      String(await probe.client("LIST"))
        .trim()
        .split("\n").length;
    try {
      const clientsBefore = await countClients();
      const port = await unusedLocalPort();
      const wait = fakeClock();

      const error: unknown = await runWorkerApp({
        features: [],
        migrations: false,
        envSource: {
          DATABASE_URL: `postgres://kumiko:kumiko@127.0.0.1:${port}/kumiko`,
          REDIS_URL: redisUrl(),
          JWT_SECRET: "test-outage-secret-32-chars-minimum!!",
        },
        databaseWait: wait.clock,
      }).then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(Error);
      expect(wait.sleeps.length).toBeGreaterThan(1);
      expect(wait.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(WAIT_FOR_DATABASE_DEADLINE_MS);
      expect(wait.logs[0]).toContain("database not reachable");
      await waitFor(async () => {
        expect(await countClients()).toBe(clientsBefore);
      });
    } finally {
      probe.disconnect();
    }
  });
});

describe("boot seeds", () => {
  let stack: TestStack | undefined;
  afterAll(async () => {
    await stack?.cleanup();
  });

  async function seedDeps() {
    stack = await setupTestStack({ features: [createConfigFeature()] });
    return { db: stack.db, registry: stack.registry };
  }

  test("a transient connection error is retried with backoff and the seed runs on the second attempt", async () => {
    const { db, registry } = await seedDeps();
    const wait = fakeClock();
    let calls = 0;
    await applyStandardBootSeeds({
      db,
      registry,
      admin: undefined,
      cipher: undefined,
      processName: "test",
      databaseWait: wait.clock,
      shortcutSeeds: [
        async () => {
          calls++;
          if (calls === 1) throw pgError("ECONNREFUSED");
        },
      ],
    });
    expect(calls).toBe(2);
    expect(wait.sleeps).toEqual([1_000]);
  });

  test("a validation failure stays fatal and is not retried", async () => {
    const { db, registry } = await seedDeps();
    const wait = fakeClock();
    let calls = 0;
    await expect(
      applyStandardBootSeeds({
        db,
        registry,
        admin: undefined,
        cipher: undefined,
        processName: "test",
        databaseWait: wait.clock,
        shortcutSeeds: [
          async () => {
            calls++;
            throw new Error("invalid seed payload");
          },
        ],
      }),
    ).rejects.toThrow("invalid seed payload");
    expect(calls).toBe(1);
    expect(wait.sleeps).toEqual([]);
  });
});
