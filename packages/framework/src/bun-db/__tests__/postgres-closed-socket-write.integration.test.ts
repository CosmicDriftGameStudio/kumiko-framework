// Guards the nextWrite null-socket backport (porsager/postgres#1209) on the
// @bender0oo0/postgres fork pinned in package.json: reserve a connection, kill
// the backend socket mid-flight, then send another query on the reserved
// connection. Upstream postgres 3.4.9 crashes the process with an
// uncaughtException ("null is not an object (evaluating 'socket.write')")
// instead of rejecting; the fork rejects with CONNECTION_CLOSED. Must stay
// green after switching back to an upstream release (kumiko-framework#3248).

import { afterEach, beforeEach, expect, test } from "bun:test";
import net from "node:net";
import postgres from "postgres";
import { testDatabaseUrl } from "../../testing/closed-connection-error";

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

test("reserved connection rejects with CONNECTION_CLOSED instead of crashing on a dead socket", async () => {
  let downstream: net.Socket | undefined;
  const proxy = net.createServer((socket) => {
    downstream = socket;
    const upstream = net.connect(Number(dbUrl.port), dbUrl.hostname);
    socket.pipe(upstream).pipe(socket);
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, resolve));
  const address = proxy.address();
  if (address === null || typeof address === "string") {
    throw new Error("proxy did not bind to a TCP port");
  }

  const sql = postgres({
    host: "127.0.0.1",
    port: address.port,
    user: dbUrl.username,
    password: dbUrl.password,
    database: dbUrl.pathname.slice(1),
    max: 1,
  });

  try {
    const reserved = await sql.reserve();
    try {
      await reserved`select 1`;
      downstream?.end();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const HANG = Symbol("hang");
      const result = await Promise.race([
        reserved`select 1`.then(
          () => {
            throw new Error("expected the query to reject with CONNECTION_CLOSED, but it resolved");
          },
          (err: unknown) => err,
        ),
        new Promise((resolve) => setTimeout(() => resolve(HANG), 3000)),
      ]);

      if (result === HANG) {
        throw new Error("query on the dead-socket connection hung instead of rejecting");
      }
      expect(result).toMatchObject({ code: "CONNECTION_CLOSED" });
      // Give the process a tick to surface an uncaughtException if the guard regressed.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(uncaught).toBeUndefined();
    } finally {
      reserved.release();
    }
  } finally {
    proxy.close();
    await sql.end({ timeout: 1 });
  }
});
