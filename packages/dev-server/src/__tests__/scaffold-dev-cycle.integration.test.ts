// Verifies that setupTestStack survives a reboot with an expanded feature set
// on a persistent DB: a new r.entity without the migration CLI must create its
// table, while an existing entity must not crash because of a duplicate CREATE.
//
// This is the path triggered by `bun dev` with KUMIKO_DEV_DB_NAME: the developer
// edits src/features/notes.ts, `bun --watch` reboots the process, and runDevApp
// calls createKumikoServer → setupTestStack with the same DB name. The new Notes
// entity must appear as a table without the developer running
// `kumiko schema apply`. If the filter in push-entity-projection-tables
// (test-stack.ts:200-209) breaks, the development flow gives a false result.

import { afterAll, describe, expect, test } from "bun:test";
import { asRawClient, createDbConnection, tableExists } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import {
  pushEntityProjectionTables,
  setupTestStack,
  type TestStack,
} from "@cosmicdrift/kumiko-testing/stack";

const baseEntity = createEntity({
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
  table: "phase2_base_thing",
});

const noteEntity = createEntity({
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
  table: "phase2_note",
});

const baseFeature: FeatureDefinition = defineFeature("phase2-base", (r) => {
  r.entity({ name: "base-thing", ...baseEntity });
});

const notesFeature: FeatureDefinition = defineFeature("phase2-notes", (r) => {
  r.entity({ name: "note", ...noteEntity });
});

const dbName = `kumiko_phase2_${generateId().slice(-8)}`;

afterAll(async () => {
  const base = process.env["TEST_DATABASE_URL"];
  if (!base) return;
  const adminUrl = base.replace(/\/[^/]+$/, "/postgres");
  const admin = createDbConnection({ url: adminUrl, maxConnections: 1 });
  try {
    await asRawClient(admin.db).unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await admin.close();
  }
});

describe("scaffold dev cycle (Phase 2 Validator)", () => {
  test("persistent reboot with added entity creates only the new table", async () => {
    const base = process.env["TEST_DATABASE_URL"];
    if (!base) throw new Error("TEST_DATABASE_URL required");

    // Boot 1: only base feature, persistent DB.
    const stack1: TestStack = await setupTestStack({
      features: [baseFeature],
      dbName,
      persistentDb: true,
    });
    try {
      await pushEntityProjectionTables(stack1, stack1.registry);
      expect(await tableExists(stack1.db, "public.phase2_base_thing")).toBe(true);
      expect(await tableExists(stack1.db, "public.phase2_note")).toBe(false);
    } finally {
      await stack1.cleanup();
    }

    // Boot 2: base + notes — simulates the developer edit + bun --watch reboot.
    // pushEntityProjectionTables MUST skip phase2_base_thing (it exists)
    // and create phase2_note — otherwise duplicate CREATE TABLE causes a crash
    // or the Notes table is missing.
    const stack2: TestStack = await setupTestStack({
      features: [baseFeature, notesFeature],
      dbName,
      persistentDb: true,
    });
    try {
      await pushEntityProjectionTables(stack2, stack2.registry);
      expect(await tableExists(stack2.db, "public.phase2_base_thing")).toBe(true);
      expect(await tableExists(stack2.db, "public.phase2_note")).toBe(true);
    } finally {
      await stack2.cleanup();
    }

    // Boot 3 with same feature-set must remain idempotent (no double-CREATE).
    const stack3: TestStack = await setupTestStack({
      features: [baseFeature, notesFeature],
      dbName,
      persistentDb: true,
    });
    try {
      await pushEntityProjectionTables(stack3, stack3.registry);
      expect(await tableExists(stack3.db, "public.phase2_note")).toBe(true);
    } finally {
      await stack3.cleanup();
    }
  });
});
