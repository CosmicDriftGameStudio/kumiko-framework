import { describe, expect, test } from "bun:test";
import { testDatabaseUrl } from "@cosmicdrift/kumiko-testing/helpers";
import { createDbConnection, openUnboundedSiblingPool } from "../connection.ts";

async function showSetting(
  runner: { unsafe: (sql: string) => PromiseLike<readonly unknown[]> },
  name: string,
): Promise<unknown> {
  const rows = await runner.unsafe(`SHOW ${name}`);
  const row = rows[0];
  return typeof row === "object" && row !== null ? Reflect.get(row, name) : undefined;
}

describe("createDbConnection driver options", () => {
  test("ssl require fails against a server without SSL", async () => {
    const handle = createDbConnection({
      url: testDatabaseUrl(),
      maxConnections: 1,
      ssl: "require",
    });
    try {
      const error = await handle.client
        .unsafe("SELECT 1")
        .then(() => undefined)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "ERR_POSTGRES_TLS_NOT_AVAILABLE" });
    } finally {
      await handle.close();
    }
  });

  // Bun.SQL's internal sslMode: 2 = require (no certificate check), 4 = verify-full.
  test("ssl true and TLS objects without rejectUnauthorized keep certificate verification", async () => {
    const cases = [
      { ssl: true, sslMode: 4 },
      { ssl: {}, sslMode: 4 },
      { ssl: { rejectUnauthorized: false }, sslMode: 2 },
      { ssl: "require", sslMode: 2 },
    ] as const;
    for (const { ssl, sslMode } of cases) {
      const handle = createDbConnection({ url: testDatabaseUrl(), ssl });
      try {
        expect(Reflect.get(handle.client.options, "sslMode")).toBe(sslMode);
      } finally {
        await handle.close();
      }
    }
  });

  test("session timeouts reach the server and the unbounded sibling disables the statement timeout", async () => {
    const handle = createDbConnection({
      url: testDatabaseUrl(),
      maxConnections: 1,
      statementTimeoutMs: 12_345,
      idleInTransactionSessionTimeoutMs: 23_456,
      lockTimeoutMs: 3_456,
    });
    try {
      expect(await showSetting(handle.client, "statement_timeout")).toBe("12345ms");
      expect(await showSetting(handle.client, "idle_in_transaction_session_timeout")).toBe(
        "23456ms",
      );
      expect(await showSetting(handle.client, "lock_timeout")).toBe("3456ms");

      const sibling = openUnboundedSiblingPool(handle.db);
      if (sibling === undefined) throw new Error("sibling pool factory missing");
      try {
        expect(await showSetting(sibling.client, "statement_timeout")).toBe("0");
        expect(await showSetting(sibling.client, "lock_timeout")).toBe("3456ms");
      } finally {
        await sibling.close(1);
      }
    } finally {
      await handle.close();
    }
  });
});
