// Whole-type removal (`kumiko events prune`): the claims pinned here are that exactly the named
// types leave the log with everything per-aggregate hanging off them, that a kept type stays
// byte-identical, and that the projection rebuild `schema apply` runs is green afterwards even
// when old events of a removed type violate a NOT NULL column on replay.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { asRawClient } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { createTenantDb, type TenantDb } from "../../db/tenant-db.ts";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { createRegistry } from "../../engine/registry.ts";
import { archiveStream } from "../../event-store/archive.ts";
import { append } from "../../event-store/index.ts";
import {
  createRebuildDeadLetterTable,
  recordRebuildDeadLetters,
} from "../../event-store/rebuild-dead-letter.ts";
import { saveSnapshot } from "../../event-store/snapshot.ts";
import {
  createUpcasterDeadLetterTable,
  recordUpcasterDeadLetter,
} from "../../event-store/upcaster-dead-letter.ts";
import { runEventsCli } from "../../events-cli.ts";
import { rebuildProjectionOrMultiStream } from "../../migrations/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { generateId } from "../../utils/index.ts";
import { removeAggregateTypes } from "../aggregate-type-removal.ts";

const requiredText = { personal: false, reason: "test_fixture", required: true } as const;

const releaseEntity = createEntity({
  table: "read_evprune_release",
  fields: { appId: createTextField(requiredText), name: createTextField(requiredText) },
});
const fileEntity = createEntity({
  table: "read_evprune_file",
  fields: { name: createTextField(requiredText) },
});
const keptEntity = createEntity({
  table: "read_evprune_kept",
  fields: { name: createTextField(requiredText) },
});

const RELEASE = "legacy-release";
const FILE = "legacy-file";
const KEPT = "kept-item";

const feature = defineFeature("evprune", (r) => {
  r.entity({ name: RELEASE, ...releaseEntity });
  r.entity({ name: FILE, ...fileEntity });
  r.entity({ name: KEPT, ...keptEntity });
});

const mixedFeature = defineFeature("evprunemixed", (r) => {
  r.entity({ name: "mixed-a", ...keptEntity, table: "read_evprune_mixed_a" });
  r.entity({ name: "mixed-b", ...keptEntity, table: "read_evprune_mixed_b" });
  r.projection({
    name: "mixed-both",
    source: ["mixed-a", "mixed-b"],
    table: buildEntityTable("mixed-a", keptEntity),
    apply: {},
  });
});

const admin = TestUsers.admin;
const DB_NAME = `kumiko_evprune_${generateId().slice(-8)}`;
const releaseTable = buildEntityTable(RELEASE, releaseEntity);
const fileTable = buildEntityTable(FILE, fileEntity);
const keptTable = buildEntityTable(KEPT, keptEntity);

let stack: TestStack;
let tdb: TenantDb;
let previousDatabaseUrl: string | undefined;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature], dbName: DB_NAME });
  await unsafeCreateEntityTable(stack.db, releaseEntity, RELEASE);
  await unsafeCreateEntityTable(stack.db, fileEntity, FILE);
  await unsafeCreateEntityTable(stack.db, keptEntity, KEPT);
  await createRebuildDeadLetterTable(stack.db);
  await createUpcasterDeadLetterTable(stack.db);
  tdb = createTenantDb({ db: stack.db, tenantId: admin.tenantId });
  previousDatabaseUrl = process.env["DATABASE_URL"];
  const baseUrl = process.env["TEST_DATABASE_URL"];
  if (!baseUrl) throw new Error("TEST_DATABASE_URL not set — required for this test file");
  process.env["DATABASE_URL"] = baseUrl.replace(/\/[^/]+$/, `/${DB_NAME}`);
});

afterAll(async () => {
  if (previousDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = previousDatabaseUrl;
  await stack.cleanup();
});

async function sql<T>(text: string): Promise<readonly T[]> {
  return (await asRawClient(stack.db).unsafe(text)) as readonly T[];
}

async function count(table: string, where = "TRUE"): Promise<number> {
  const rows = await sql<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${where}`);
  return rows[0]?.n ?? 0;
}

async function snapshotOf(aggregateType: string, aggregateId: string): Promise<void> {
  await saveSnapshot(stack.db, {
    aggregateId,
    tenantId: admin.tenantId,
    aggregateType,
    version: 1,
    state: { name: "snap" },
  });
}

// The prod shape: an old event of a type whose entity has since gained a required column.
async function appendLegacyReleaseWithoutAppId(): Promise<string> {
  const aggregateId = generateId();
  const stored = await append(stack.db, {
    aggregateId,
    aggregateType: RELEASE,
    tenantId: admin.tenantId,
    expectedVersion: 0,
    type: `${RELEASE}.created`,
    payload: { name: "old" },
    metadata: { userId: admin.id },
  });
  await snapshotOf(RELEASE, aggregateId);
  await recordUpcasterDeadLetter(stack.db, {
    event: stored,
    fromVersion: 1,
    targetVersion: 2,
    error: "x",
  });
  await recordRebuildDeadLetters(stack.db, "evprune:projection:legacy-release", [
    { event: stored, error: "x" },
  ]);
  return aggregateId;
}

beforeEach(async () => {
  await sql(
    `TRUNCATE kumiko_events, kumiko_snapshots, kumiko_archived_streams, kumiko_upcaster_dead_letters, kumiko_rebuild_dead_letters, kumiko_projections, read_evprune_release, read_evprune_file, read_evprune_kept RESTART IDENTITY CASCADE`,
  );
  const releases = createEventStoreExecutor(releaseTable, releaseEntity, { entityName: RELEASE });
  const files = createEventStoreExecutor(fileTable, fileEntity, { entityName: FILE });
  const kept = createEventStoreExecutor(keptTable, keptEntity, { entityName: KEPT });
  await releases.create({ appId: "a1", name: "r1" }, admin, tdb);
  await files.create({ name: "f1" }, admin, tdb);
  await files.create({ name: "f2" }, admin, tdb);
  await kept.create({ name: "k1" }, admin, tdb);
  await kept.create({ name: "k2" }, admin, tdb);
  await appendLegacyReleaseWithoutAppId();
  const fileId =
    (await sql<{ id: string }>(`SELECT id FROM read_evprune_file LIMIT 1`))[0]?.id ?? "";
  const keptId =
    (await sql<{ id: string }>(`SELECT id FROM read_evprune_kept LIMIT 1`))[0]?.id ?? "";
  await snapshotOf(FILE, fileId);
  await snapshotOf(KEPT, keptId);
  await archiveStream(stack.db, {
    tenantId: admin.tenantId,
    aggregateId: fileId,
    aggregateType: FILE,
    archivedBy: admin.id,
  });
});

const removed = { types: [RELEASE, FILE] };

describe("removeAggregateTypes — dry run", () => {
  test("reports counts per type and deletes nothing", async () => {
    const eventsBefore = await count("kumiko_events");
    const result = await removeAggregateTypes(stack.db, stack.registry, {
      ...removed,
      apply: false,
    });

    expect(result.deleted).toBeUndefined();
    expect(result.plan.stats).toEqual([
      { aggregateType: RELEASE, events: 2, aggregates: 2, tenants: 1 },
      { aggregateType: FILE, events: 2, aggregates: 2, tenants: 1 },
    ]);
    expect(await count("kumiko_events")).toBe(eventsBefore);
    expect(await count("read_evprune_release")).toBe(1);
    expect(await count("kumiko_snapshots")).toBe(3);
  });
});

describe("removeAggregateTypes — apply", () => {
  test("removes exactly the named types and leaves the kept type untouched", async () => {
    const keptEventsBefore = await sql(
      `SELECT * FROM kumiko_events WHERE aggregate_type = '${KEPT}' ORDER BY id`,
    );
    const keptRowsBefore = await sql(`SELECT * FROM read_evprune_kept ORDER BY id`);

    const result = await removeAggregateTypes(stack.db, stack.registry, {
      ...removed,
      apply: true,
    });

    expect(result.deleted).toMatchObject({
      events: 4,
      snapshots: 2,
      archivedStreams: 1,
      upcasterDeadLetters: 1,
      rebuildDeadLetters: 1,
    });
    expect(await count("kumiko_events", `aggregate_type IN ('${RELEASE}', '${FILE}')`)).toBe(0);
    expect(await count("kumiko_snapshots", `aggregate_type IN ('${RELEASE}', '${FILE}')`)).toBe(0);
    expect(await count("kumiko_archived_streams")).toBe(0);
    expect(await count("kumiko_upcaster_dead_letters")).toBe(0);
    expect(await count("kumiko_rebuild_dead_letters")).toBe(0);
    expect(await count("read_evprune_release")).toBe(0);
    expect(await count("read_evprune_file")).toBe(0);

    expect(
      await sql(`SELECT * FROM kumiko_events WHERE aggregate_type = '${KEPT}' ORDER BY id`),
    ).toEqual(keptEventsBefore);
    expect(await sql(`SELECT * FROM read_evprune_kept ORDER BY id`)).toEqual(keptRowsBefore);
    expect(await count("kumiko_snapshots", `aggregate_type = '${KEPT}'`)).toBe(1);
  });

  test("a rebuild over the registry fails on the legacy event before and passes after", async () => {
    const rebuildAll = async () => {
      for (const name of stack.registry.getAllProjections().keys()) {
        await rebuildProjectionOrMultiStream(name, { db: stack.db, registry: stack.registry });
      }
    };
    await expect(rebuildAll()).rejects.toThrow(/null value|not-null|app_id/i);

    await removeAggregateTypes(stack.db, stack.registry, { ...removed, apply: true });

    await rebuildAll();
    expect(await count("read_evprune_kept")).toBe(2);
    expect(await count("read_evprune_release")).toBe(0);
  });

  test("refuses, deleting nothing, when a projection mixes removed and other types", async () => {
    const mixedRegistry = createRegistry([feature, mixedFeature]);
    await expect(
      removeAggregateTypes(stack.db, mixedRegistry, { types: ["mixed-a"], apply: true }),
    ).rejects.toThrow(/Refusing.*mixed-both/);
    expect(await count("kumiko_events")).toBe(6);
  });
});

describe("runEventsCli", () => {
  function capture() {
    const lines: string[] = [];
    return {
      lines,
      out: { log: (l: string) => lines.push(l), err: (l: string) => lines.push(`ERR ${l}`) },
    };
  }
  const options = { features: [feature], rowLevelSecurity: "off" } as const;

  test("dry run prints counts without row content and exits 0", async () => {
    const { out, lines } = capture();
    const code = await runEventsCli(["prune", "--aggregate-type", RELEASE], out, options);
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain(`${RELEASE}: 2 events, 2 aggregates, 1 tenants`);
    expect(text).toContain("Dry run");
    expect(text).not.toContain(process.env["DATABASE_URL"] ?? "unset");
    expect(await count("kumiko_events")).toBe(6);
  });

  test("--apply deletes through the CLI", async () => {
    const { out } = capture();
    const code = await runEventsCli(
      ["prune", "--aggregate-type", RELEASE, "--apply"],
      out,
      options,
    );
    expect(code).toBe(0);
    expect(await count("kumiko_events", `aggregate_type = '${RELEASE}'`)).toBe(0);
    expect(await count("kumiko_events", `aggregate_type = '${FILE}'`)).toBe(2);
  });

  test.each([
    [
      "unknown type",
      ["prune", "--aggregate-type", "no-such-type", "--apply"],
      "Unknown aggregate type",
    ],
    ["missing type", ["prune", "--apply"], "At least one"],
    ["unknown flag", ["prune", "--aggregate-type", RELEASE, "--force"], "Unknown argument"],
    ["unknown subcommand", ["purge"], "Unknown subcommand"],
  ])("%s exits non-zero and changes nothing", async (_name, argv, message) => {
    const { out, lines } = capture();
    expect(await runEventsCli(argv, out, options)).toBe(1);
    expect(lines.join("\n")).toContain(message);
    expect(await count("kumiko_events")).toBe(6);
    expect(await count("read_evprune_release")).toBe(1);
  });

  test("a valid type next to an unknown one deletes nothing", async () => {
    const { out } = capture();
    const code = await runEventsCli(
      ["prune", "--aggregate-type", RELEASE, "--aggregate-type", "no-such-type", "--apply"],
      out,
      options,
    );
    expect(code).toBe(1);
    expect(await count("kumiko_events", `aggregate_type = '${RELEASE}'`)).toBe(2);
  });
});
