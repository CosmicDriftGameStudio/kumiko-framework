// Reserve a connection, kill the backend socket mid-flight, then send another
// query on the reserved connection: Bun.SQL must reject with
// ERR_POSTGRES_CONNECTION_CLOSED instead of hanging or crashing the process.

import { afterEach, beforeEach, expect, test } from "bun:test";
import net from "node:net";
import { sleep, testDatabaseUrl } from "@cosmicdrift/kumiko-testing/helpers";

const DATABASE_URL = testDatabaseUrl();
const dbUrl = new URL(DATABASE_URL);

let uncaught: unknown;
function onUncaught(err: unknown): void {
  uncaught = err;
}

beforeEach(() => {
  uncaught = undefined;
  process.on("uncaughtException", onUncaught);
});

afterEach(() => {
  process.off("uncaughtException", onUncaught);
});

test("reserved connection rejects with ERR_POSTGRES_CONNECTION_CLOSED instead of crashing on a dead socket", async () => {
  let downstream: net.Socket | undefined;
  const upstreams: net.Socket[] = [];
  const proxy = net.createServer((socket) => {
    downstream = socket;
    const upstream = net.connect(Number(dbUrl.port), dbUrl.hostname);
    upstreams.push(upstream);
    socket.pipe(upstream).pipe(socket);
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, resolve));
  const address = proxy.address();
  if (address === null || typeof address === "string") {
    throw new Error("proxy did not bind to a TCP port");
  }

  const sql = new Bun.SQL({
    adapter: "postgres",
    hostname: "127.0.0.1",
    port: address.port,
    username: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    database: dbUrl.pathname.slice(1),
    max: 1,
  });

  try {
    const reserved = await sql.reserve();
    try {
      await reserved`select 1`;
      downstream?.end();
      // No observable signal for the FIN reaching the client socket.
      await sleep(50);

      const HANG = Symbol("hang");
      let hangTimer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reserved`select 1`.then(
          () => {
            throw new Error(
              "expected the query to reject with ERR_POSTGRES_CONNECTION_CLOSED, but it resolved",
            );
          },
          (err: unknown) => err,
        ),
        new Promise((resolve) => {
          hangTimer = setTimeout(() => resolve(HANG), 3000);
        }),
      ]).finally(() => clearTimeout(hangTimer));

      if (result === HANG) {
        throw new Error("query on the dead-socket connection hung instead of rejecting");
      }
      expect(result).toMatchObject({ code: "ERR_POSTGRES_CONNECTION_CLOSED" });
      // Give the process a tick to surface an uncaughtException if the guard regressed.
      await sleep(50);
      expect(uncaught).toBeUndefined();
    } finally {
      reserved.release();
    }
  } finally {
    for (const upstream of upstreams) upstream.destroy();
    proxy.close();
    await sql.close({ timeout: 1 });
  }
});
