// Shared fixture of the aggregate-type-removal integration tests: three entity types, one
// projection mixing two of them, and a seed that covers every per-aggregate table.

import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { asRawClient } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { createTenantDb } from "../../db/tenant-db.ts";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
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
import { TestUsers } from "../../seeding/seed-users.ts";
import { generateId } from "../../utils/index.ts";

const requiredText = { personal: false, reason: "test_fixture", required: true } as const;

export const releaseEntity = createEntity({
  table: "read_evprune_release",
  fields: { appId: createTextField(requiredText), name: createTextField(requiredText) },
});
export const fileEntity = createEntity({
  table: "read_evprune_file",
  fields: { name: createTextField(requiredText) },
});
export const keptEntity = createEntity({
  table: "read_evprune_kept",
  fields: { name: createTextField(requiredText) },
});

export const RELEASE = "legacy-release";
export const FILE = "legacy-file";
export const KEPT = "kept-item";

export const feature = defineFeature("evprune", (r) => {
  r.entity({ name: RELEASE, ...releaseEntity });
  r.entity({ name: FILE, ...fileEntity });
  r.entity({ name: KEPT, ...keptEntity });
});

export const mixedFeature = defineFeature("evprunemixed", (r) => {
  r.entity({ name: "mixed-a", ...keptEntity, table: "read_evprune_mixed_a" });
  r.entity({ name: "mixed-b", ...keptEntity, table: "read_evprune_mixed_b" });
  r.projection({
    name: "mixed-both",
    source: ["mixed-a", "mixed-b"],
    table: buildEntityTable("mixed-a", keptEntity),
    apply: {},
  });
});

// Dotted key = removed type "mixed-a"; the qualified key has no derivable aggregate type.
export const mixedStreamFeature = defineFeature("evprunemsp", (r) => {
  r.entity({ name: "msp-a", ...keptEntity, table: "read_evprune_msp_a" });
  r.multiStreamProjection({
    name: "msp-both",
    table: buildEntityTable("msp-a", keptEntity),
    apply: { "msp-a.created": async () => {}, "evprunemsp:event:other": async () => {} },
  });
});

export const admin = TestUsers.admin;
export const releaseTable = buildEntityTable(RELEASE, releaseEntity);
export const fileTable = buildEntityTable(FILE, fileEntity);
export const keptTable = buildEntityTable(KEPT, keptEntity);

export async function createFixtureTables(stack: TestStack): Promise<void> {
  await unsafeCreateEntityTable(stack.db, releaseEntity, RELEASE);
  await unsafeCreateEntityTable(stack.db, fileEntity, FILE);
  await unsafeCreateEntityTable(stack.db, keptEntity, KEPT);
  await createRebuildDeadLetterTable(stack.db);
  await createUpcasterDeadLetterTable(stack.db);
}

export async function sql<T>(stack: TestStack, text: string): Promise<readonly T[]> {
  return (await asRawClient(stack.db).unsafe(text)) as readonly T[];
}

export async function count(stack: TestStack, table: string, where = "TRUE"): Promise<number> {
  const rows = await sql<{ n: number }>(
    stack,
    `SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${where}`,
  );
  return rows[0]?.n ?? 0;
}

async function snapshotOf(stack: TestStack, aggregateType: string, aggregateId: string) {
  await saveSnapshot(stack.db, {
    aggregateId,
    tenantId: admin.tenantId,
    aggregateType,
    version: 1,
    state: { name: "snap" },
  });
}

// The prod shape: an old event of a type whose entity has since gained a required column.
async function appendLegacyReleaseWithoutAppId(stack: TestStack): Promise<void> {
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
  await snapshotOf(stack, RELEASE, aggregateId);
  await recordUpcasterDeadLetter(stack.db, {
    event: stored,
    fromVersion: 1,
    targetVersion: 2,
    error: "x",
  });
  await recordRebuildDeadLetters(stack.db, "evprune:projection:legacy-release", [
    { event: stored, error: "x" },
  ]);
}

// 6 events: 2 releases, 2 files, 2 kept; 3 snapshots plus 1 for the legacy release; 1 archived file.
export async function seedFixture(stack: TestStack): Promise<void> {
  await sql(
    stack,
    `TRUNCATE kumiko_events, kumiko_snapshots, kumiko_archived_streams, kumiko_upcaster_dead_letters, kumiko_rebuild_dead_letters, kumiko_projections, read_evprune_release, read_evprune_file, read_evprune_kept RESTART IDENTITY CASCADE`,
  );
  const tdb = createTenantDb({ db: stack.db, tenantId: admin.tenantId });
  const releases = createEventStoreExecutor(releaseTable, releaseEntity, { entityName: RELEASE });
  const files = createEventStoreExecutor(fileTable, fileEntity, { entityName: FILE });
  const kept = createEventStoreExecutor(keptTable, keptEntity, { entityName: KEPT });
  await releases.create({ appId: "a1", name: "r1" }, admin, tdb);
  await files.create({ name: "f1" }, admin, tdb);
  await files.create({ name: "f2" }, admin, tdb);
  await kept.create({ name: "k1" }, admin, tdb);
  await kept.create({ name: "k2" }, admin, tdb);
  await appendLegacyReleaseWithoutAppId(stack);
  const fileId =
    (await sql<{ id: string }>(stack, `SELECT id FROM read_evprune_file LIMIT 1`))[0]?.id ?? "";
  const keptId =
    (await sql<{ id: string }>(stack, `SELECT id FROM read_evprune_kept LIMIT 1`))[0]?.id ?? "";
  await snapshotOf(stack, FILE, fileId);
  await snapshotOf(stack, KEPT, keptId);
  await archiveStream(stack.db, {
    tenantId: admin.tenantId,
    aggregateId: fileId,
    aggregateType: FILE,
    archivedBy: admin.id,
  });
}
