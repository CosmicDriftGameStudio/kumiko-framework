// Integration-Test für `runConsumerCli` (kumiko-framework#1351).
//
// Standalone Ops-CLI-Wrapper um getConsumerState/restartConsumer — die
// Recovery-Semantik selbst ist bereits in event-dispatcher-recovery
// abgedeckt, hier nur der CLI-Layer: argv-parsing, DB-Connection-Handling,
// Exit-Codes, Output-Formatierung.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../bun-db/__tests__/bun-test-db";
import { type ConsumerCliOut, runConsumerCli } from "../consumer-cli";
import { insertConsumerIfAbsent, markConsumerRebuildFailed } from "../db/queries/event-consumer";
import { asRawClient } from "../db/query";
import { createEventConsumerStateTable } from "../pipeline";
import { ensureTemporalPolyfill } from "../time/polyfill";

const SHARED = "__shared__";

let testDb: BunTestDb;
let testUrl: string;
let prevDbUrl: string | undefined;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  const baseUrl = process.env["TEST_DATABASE_URL"];
  if (!baseUrl) throw new Error("TEST_DATABASE_URL not set — required for this test file");
  testUrl = baseUrl.replace(/\/[^/]+$/, `/${testDb.dbName}`);
  await createEventConsumerStateTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

afterEach(async () => {
  await asRawClient(testDb.db).unsafe(`TRUNCATE TABLE "kumiko_event_consumers"`);
  if (prevDbUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = prevDbUrl;
});

function captureOut(): { out: ConsumerCliOut; lines: string[] } {
  const lines: string[] = [];
  return {
    out: { log: (l: string) => lines.push(l), err: (l: string) => lines.push(`ERR ${l}`) },
    lines,
  };
}

describe("runConsumerCli status", () => {
  test("unknown consumer → exit 1, not-found message", async () => {
    prevDbUrl = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = testUrl;
    const { out, lines } = captureOut();
    const code = await runConsumerCli(["status", "no-such-consumer"], out);
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("not found");
  });

  test("known consumer → exit 0, reports status/cursor/attempts", async () => {
    prevDbUrl = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = testUrl;
    await insertConsumerIfAbsent(testDb.db, "test:consumer:foo", SHARED);
    const { out, lines } = captureOut();
    const code = await runConsumerCli(["status", "test:consumer:foo"], out);
    expect(code).toBe(0);
    const joined = lines.join("\n");
    expect(joined).toContain("test:consumer:foo");
    expect(joined).toContain("status:      idle");
  });

  test("missing <name> → exit 1, usage message", async () => {
    prevDbUrl = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = testUrl;
    const { out, lines } = captureOut();
    const code = await runConsumerCli(["status"], out);
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("Usage:");
  });

  test("missing DATABASE_URL → exit 1", async () => {
    prevDbUrl = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];
    const { out, lines } = captureOut();
    const code = await runConsumerCli(["status", "whatever"], out);
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("DATABASE_URL not set");
  });
});

describe("runConsumerCli restart", () => {
  test("dead consumer → idle, exit 0", async () => {
    prevDbUrl = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = testUrl;
    await insertConsumerIfAbsent(testDb.db, "test:consumer:bar", SHARED);
    await markConsumerRebuildFailed(testDb.db, "test:consumer:bar", SHARED, "boom");
    const { out, lines } = captureOut();
    const code = await runConsumerCli(["restart", "test:consumer:bar"], out);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("→ idle");
  });

  test("non-dead consumer → propagated error, exit 1", async () => {
    prevDbUrl = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = testUrl;
    await insertConsumerIfAbsent(testDb.db, "test:consumer:baz", SHARED);
    const { out, lines } = captureOut();
    const code = await runConsumerCli(["restart", "test:consumer:baz"], out);
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("not dead");
  });
});
