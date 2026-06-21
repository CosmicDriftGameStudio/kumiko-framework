// Phase-2 Validator (Plan-Doc create-kumiko-app.md, Risk #1): pinnt dass
// setupTestStack auf persistent DB einen Reboot mit erweitertem Feature-Set
// überlebt — eine neue r.entity ohne Migration-CLI muss die Tabelle anlegen,
// und ein bereits existierendes Entity darf nicht crashen (duplicate CREATE).
//
// Das ist der Pfad den `bun dev` mit KUMIKO_DEV_DB_NAME triggert: der
// Dev-User editiert src/features/notes.ts, `bun --watch` rebootet den Process,
// runDevApp ruft createKumikoServer → setupTestStack mit denselben DB-Name
// auf, und das neue Notes-Entity muss als Tabelle erscheinen ohne dass der
// User `kumiko schema apply` aufgerufen hat. Bricht der Filter in
// push-entity-projection-tables (test-stack.ts:200-209), lügt der Dev-Flow.

import { afterAll, describe, expect, test } from "bun:test";
import { asRawClient, createDbConnection, tableExists } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  pushEntityProjectionTables,
  setupTestStack,
  type TestStack,
} from "@cosmicdrift/kumiko-framework/stack";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";

const baseEntity = createEntity({
  fields: { title: createTextField({ required: true }) },
  table: "phase2_base_thing",
});

const noteEntity = createEntity({
  fields: { title: createTextField({ required: true }) },
  table: "phase2_note",
});

const baseFeature: FeatureDefinition = defineFeature("phase2-base", (r) => {
  r.entity("base-thing", baseEntity);
});

const notesFeature: FeatureDefinition = defineFeature("phase2-notes", (r) => {
  r.entity("note", noteEntity);
});

const dbName = `kumiko_phase2_${generateId().slice(-8)}`;

afterAll(async () => {
  const base = process.env["TEST_DATABASE_URL"];
  if (!base) return;
  const adminUrl = base.replace(/\/[^/]+$/, "/postgres");
  const admin = createDbConnection(adminUrl, { maxConnections: 1 });
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

    // Boot 2: base + notes — simulates the Dev-User edit + bun --watch reboot.
    // pushEntityProjectionTables MUSS phase2_base_thing skippen (existiert)
    // und phase2_note neu anlegen — sonst crash auf duplicate CREATE TABLE
    // oder die Notes-Tabelle fehlt.
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
