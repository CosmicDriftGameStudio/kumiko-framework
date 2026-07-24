// Integration test for `runConsumerCli` (kumiko-framework#1351).
//
// Recovery semantics themselves are already covered by
// event-dispatcher-recovery — this only exercises the CLI layer: argv
// parsing, DB-connection handling, exit codes, output formatting.

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

  test("--instance-id flag → status looks up the per-instance consumer, not shared", async () => {
    prevDbUrl = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = testUrl;
    await insertConsumerIfAbsent(testDb.db, "test:consumer:inst", "inst-1");
    const { out, lines } = captureOut();
    const code = await runConsumerCli(
      ["status", "test:consumer:inst", "--instance-id", "inst-1"],
      out,
    );
    expect(code).toBe(0);
    const joined = lines.join("\n");
    expect(joined).toContain('instance_id="inst-1"');
  });
});

describe("runConsumerCli — unknown/empty subcommand exit codes", () => {
  test("no subcommand at all → exit 0 (usage, not an error)", async () => {
    const { out, lines } = captureOut();
    const code = await runConsumerCli([], out);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("Subcommands:");
  });

  test("an unrecognized subcommand → exit 1", async () => {
    const { out, lines } = captureOut();
    const code = await runConsumerCli(["bogus"], out);
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("Subcommands:");
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
