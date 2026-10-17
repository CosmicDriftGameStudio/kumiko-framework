// The Bun provider's listenClient is Bun.SQL itself. The event dispatcher
// relies on two properties of its LISTEN connection: it survives the pool's
// idleTimeout, and after a dropped connection it re-issues LISTEN and calls
// onlisten again (the dispatcher's listen_connected gauge hangs off that).

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { testDatabaseUrl } from "../../testing/closed-connection-error.js";
import { waitFor } from "../../testing/index.js";
import { createBunConnection } from "../bun-provider.js";
import type { DbPoolHandle, PgListenSubscription } from "../connection.js";
import { asRawClient } from "../query.js";

const POOL_IDLE_TIMEOUT_SECONDS = 1;

let conn: DbPoolHandle;
let admin: DbPoolHandle;
let subscription: PgListenSubscription | null = null;

beforeAll(() => {
  conn = createBunConnection(testDatabaseUrl(), { idleTimeoutSeconds: POOL_IDLE_TIMEOUT_SECONDS });
  admin = createBunConnection(testDatabaseUrl(), { maxConnections: 1 });
});

afterEach(async () => {
  await subscription?.unlisten();
  subscription = null;
});

afterAll(async () => {
  await conn.close();
  await admin.close();
});

function uniqueChannel(): string {
  return `bun_listen_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function listenBackendPid(channel: string): Promise<number> {
  const rows = (await asRawClient(admin.db).unsafe(
    "SELECT pid FROM pg_stat_activity WHERE query = $1",
    [`LISTEN "${channel}"`],
  )) as readonly { pid: number }[];
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) {
    throw new Error(`expected one LISTEN backend for ${channel}, got ${rows.length}`);
  }
  return row.pid;
}

async function backendExists(pid: number): Promise<boolean> {
  const rows = (await asRawClient(admin.db).unsafe(
    "SELECT 1 FROM pg_stat_activity WHERE pid = $1",
    [pid],
  )) as readonly unknown[];
  return rows.length > 0;
}

async function notify(channel: string, payload: string): Promise<void> {
  await asRawClient(admin.db).unsafe("SELECT pg_notify($1, $2)", [channel, payload]);
}

type Listening = {
  readonly payloads: string[];
  onlistenCalls: () => number;
};

async function listen(channel: string): Promise<Listening> {
  const listenClient = conn.listenClient;
  if (listenClient === undefined) throw new Error("bun provider must expose a listenClient");
  const payloads: string[] = [];
  let onlistenCalls = 0;
  subscription = await listenClient.listen(
    channel,
    (payload) => {
      payloads.push(payload);
    },
    () => {
      onlistenCalls += 1;
    },
  );
  return { payloads, onlistenCalls: () => onlistenCalls };
}

describe("Bun.SQL listenClient", () => {
  test("LISTEN connection outlives the pool's idleTimeout", async () => {
    const channel = uniqueChannel();
    const listening = await listen(channel);
    expect(listening.onlistenCalls()).toBe(1);
    const listenPid = await listenBackendPid(channel);

    const poolRows = (await asRawClient(conn.db).unsafe(
      "SELECT pg_backend_pid() AS pid",
    )) as readonly { pid: number }[];
    const poolPid = poolRows[0]?.pid;
    if (poolPid === undefined) throw new Error("pool returned no backend pid");

    // The idle pool connection disappearing proves the timeout is active;
    // only then does the LISTEN backend staying put mean anything.
    await waitFor(
      async () => {
        expect(await backendExists(poolPid)).toBe(false);
      },
      { delays: [500, 1000, 1000, 1000, 2000] },
    );
    expect(await backendExists(listenPid)).toBe(true);
    expect(listening.onlistenCalls()).toBe(1);

    await notify(channel, "after-idle-timeout");
    await waitFor(() => {
      expect(listening.payloads).toEqual(["after-idle-timeout"]);
    });
  });

  test("re-LISTENs after the backend is terminated and calls onlisten again", async () => {
    const channel = uniqueChannel();
    const listening = await listen(channel);
    expect(listening.onlistenCalls()).toBe(1);
    const firstPid = await listenBackendPid(channel);

    await asRawClient(admin.db).unsafe("SELECT pg_terminate_backend($1)", [firstPid]);

    await waitFor(
      () => {
        expect(listening.onlistenCalls()).toBe(2);
      },
      { delays: [250, 500, 1000, 2000, 2000] },
    );
    const secondPid = await listenBackendPid(channel);
    expect(secondPid).not.toBe(firstPid);

    await notify(channel, "after-reconnect");
    await waitFor(() => {
      expect(listening.payloads).toEqual(["after-reconnect"]);
    });
  });
});
