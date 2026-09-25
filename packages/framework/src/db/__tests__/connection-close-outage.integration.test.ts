// A DB outage must not turn process shutdown into a hang: postgres.js keeps
// an in-flight query referenced on a dead socket, so a plain end() (no
// timeout = wait for queries to finish) never resolves once the DB is gone.
// close() has to bound that wait (db/api.ts's closeTimeoutSeconds). Routes
// createDbConnection through a TCP proxy that stops forwarding bytes after
// connect ("blackhole") — same simulated-outage approach as
// pipeline/__tests__/event-dispatcher-db-outage.integration.test.ts, but
// without touching the shared test DB's actual availability.

import { afterAll, describe, expect, test } from "bun:test";
import net from "node:net";
import { waitFor } from "../../testing";
import { testDatabaseUrl } from "../../testing/closed-connection-error";
import { createDbConnection } from "../connection";

function startBlackholeProxy(dbUrl: URL): {
  readonly server: net.Server;
  blackhole: () => void;
  swallowedBytes: () => number;
  destroy: () => void;
} {
  let blackholed = false;
  let swallowed = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((downstream) => {
    sockets.add(downstream);
    const upstream = net.connect(Number(dbUrl.port), dbUrl.hostname);
    sockets.add(upstream);
    downstream.on("data", (chunk: Buffer) => {
      if (blackholed) {
        swallowed += chunk.length;
        return;
      }
      upstream.write(chunk);
    });
    upstream.on("data", (chunk: Buffer) => {
      if (!blackholed) downstream.write(chunk);
    });
    downstream.on("error", () => {});
    upstream.on("error", () => {});
    downstream.on("close", () => sockets.delete(downstream));
    upstream.on("close", () => sockets.delete(upstream));
  });
  return {
    server,
    blackhole: () => {
      blackholed = true;
    },
    swallowedBytes: () => swallowed,
    destroy: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

async function listenOn(server: net.Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
}

let proxy: ReturnType<typeof startBlackholeProxy>;

afterAll(() => {
  proxy?.destroy();
});

describe("createDbConnection close() bounds shutdown during a DB outage", () => {
  test("close() resolves within the bounded timeout even with in-flight queries on a dead socket", async () => {
    const dbUrl = new URL(testDatabaseUrl());
    proxy = startBlackholeProxy(dbUrl);
    await listenOn(proxy.server, 0);
    const address = proxy.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("proxy did not bind to a TCP port");
    }

    const proxiedUrl = new URL(dbUrl.toString());
    proxiedUrl.hostname = "127.0.0.1";
    proxiedUrl.port = String(address.port);

    const conn = createDbConnection(proxiedUrl.toString(), {
      maxConnections: 1,
      closeTimeoutSeconds: 1,
    });

    // Establish the connection while the proxy still forwards normally —
    // isolates the assertion to close()'s own timeout, not connect_timeout.
    await conn.client.unsafe("select 1");

    // Fired without awaiting: once the socket goes dead, end() has to
    // reject these instead of waiting on them forever. .catch prevents an
    // unhandled rejection when end() tears the connection down.
    const inFlightBeforeBlackhole = conn.client.unsafe("select 1").catch(() => undefined);
    proxy.blackhole();
    const inFlightAfterBlackhole = conn.client.unsafe("select 1").catch(() => undefined);

    await waitFor(() => proxy.swallowedBytes() > 0);

    const start = Date.now();
    await conn.close();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(3000);

    await Promise.all([inFlightBeforeBlackhole, inFlightAfterBlackhole]);
  });
});
