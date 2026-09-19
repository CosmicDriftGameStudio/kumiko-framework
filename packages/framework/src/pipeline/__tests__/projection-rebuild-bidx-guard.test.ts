// Guard: rebuildProjection must fail loud instead of silently NULLing bidx
// columns when no blind-index key is configured (fw#3091). Pure unit test —
// the guard runs before any db access, so `db` is never touched here.

import { afterEach, describe, expect, test } from "bun:test";
import { configureBlindIndexKey, resetBlindIndexKeyForTests } from "../../crypto/blind-index";
import { table as pgTable, text, uuid } from "../../db/dialect";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import type { ProjectionDefinition } from "../../engine/types";
import { rebuildProjection } from "../projection-rebuild";

const sourceEntity = createEntity({
  table: "read_bidx_guard_source",
  fields: { name: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});

const bidxTable = pgTable("read_bidx_guard_bidx", {
  id: uuid("id").primaryKey(),
  emailBidx: text("email_bidx"),
});

const plainTable = pgTable("read_bidx_guard_plain", {
  id: uuid("id").primaryKey(),
  email: text("email"),
});

const bidxProjection: ProjectionDefinition = {
  name: "bidx-guard-test",
  source: "bidx-guard-source",
  table: bidxTable,
  apply: {},
};

const plainProjection: ProjectionDefinition = {
  name: "plain-guard-test",
  source: "bidx-guard-source",
  table: plainTable,
  apply: {},
};

const feature = defineFeature("bidxguardtest", (r) => {
  r.entity("bidx-guard-source", sourceEntity);
  r.projection(bidxProjection);
  r.projection(plainProjection);
});

const registry = createRegistry([feature]);

afterEach(() => {
  resetBlindIndexKeyForTests();
});

describe("rebuildProjection — blind-index guard (fw#3091)", () => {
  test("throws when the table has a *_bidx column and no key is configured", async () => {
    await expect(
      rebuildProjection("bidxguardtest:projection:bidx-guard-test", {
        db: {} as never,
        registry,
      }),
    ).rejects.toThrow(/blind-index column/);
  });

  test("does not fire the guard for a table without *_bidx columns", async () => {
    // No bidx column → the guard doesn't throw, so this fails further down
    // instead, against the fake db — proving it passed the guard.
    let error: unknown;
    try {
      await rebuildProjection("bidxguardtest:projection:plain-guard-test", {
        db: {} as never,
        registry,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(String(error)).not.toMatch(/blind-index column/);
  });

  test("does not fire the guard when the blind-index key is configured", async () => {
    configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
    let error: unknown;
    try {
      await rebuildProjection("bidxguardtest:projection:bidx-guard-test", {
        db: {} as never,
        registry,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(String(error)).not.toMatch(/blind-index column/);
  });
});
