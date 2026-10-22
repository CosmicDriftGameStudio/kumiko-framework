import { describe, expect, test } from "bun:test";
import { testDatabaseUrl } from "@cosmicdrift/kumiko-testing/helpers";
import { createDbConnection } from "../connection.ts";

describe("createDbConnection driver options", () => {
  test("onNotice receives notices raised by the server", async () => {
    const messages: string[] = [];
    const handle = createDbConnection({
      url: testDatabaseUrl(),
      maxConnections: 1,
      onNotice: (notice) => {
        messages.push(String(notice["message"]));
      },
    });
    try {
      await handle.client.unsafe("DO $$ BEGIN RAISE NOTICE 'connection-options-notice'; END $$");
      expect(messages).toContain("connection-options-notice");
    } finally {
      await handle.close();
    }
  });

  test("ssl is passed through to the driver", async () => {
    const handle = createDbConnection({
      url: testDatabaseUrl(),
      maxConnections: 1,
      ssl: "require",
    });
    try {
      expect(handle.client.options.ssl).toBeTruthy();
    } finally {
      await handle.close();
    }
  });
});
