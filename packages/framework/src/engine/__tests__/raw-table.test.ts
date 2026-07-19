// Unit tests for r.rawTable() — declaration-time validation + registry
// aggregation. Post-drizzle-cut merge of the former r.rawTable() (legacy
// Drizzle PgTable) and r.unmanagedTable() (EntityTableMeta) — this file
// absorbs the former unmanaged-table.test.ts coverage under the new name.
// Full DB roundtrip (setupTestStack pushes the table → INSERT / SELECT)
// lives in src/__tests__/raw-table.integration.test.ts.

import { describe, expect, test } from "bun:test";
import {
  buildEntityTableMeta,
  defineUnmanagedTable,
  resolveTableName,
} from "../../db/entity-table-meta";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../index";
import { createRegistry } from "../registry";

const probeMeta = defineUnmanagedTable({
  tableName: "rt_probe",
  columns: [{ name: "id", pgType: "text", notNull: true, primaryKey: true }],
});
const probeMetaTwo = defineUnmanagedTable({
  tableName: "rt_probe_two",
  columns: [{ name: "id", pgType: "text", notNull: true, primaryKey: true }],
});

describe("r.rawTable — declaration", () => {
  test("rejects an invalid table name", () => {
    const badMeta = defineUnmanagedTable({
      tableName: "BadName",
      columns: [{ name: "id", pgType: "text", notNull: true, primaryKey: true }],
    });
    expect(() =>
      defineFeature("probe", (r) => {
        r.rawTable(badMeta, { reason: "test" });
      }),
    ).toThrow(/must be a valid identifier/);
  });

  test("rejects duplicate registrations within one feature", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.rawTable(probeMeta, { reason: "test" });
        r.rawTable(probeMeta, { reason: "test" });
      }),
    ).toThrow(/already registered/);
  });

  test("rejects empty reason", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.rawTable(probeMeta, { reason: "" });
      }),
    ).toThrow(/options\.reason must be a non-empty string/);
  });

  test("rejects whitespace-only reason", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.rawTable(probeMeta, { reason: "   " });
      }),
    ).toThrow(/options\.reason must be a non-empty string/);
  });

  test("accepts valid registration and stores meta + reason", () => {
    const feature = defineFeature("probe", (r) => {
      r.rawTable(probeMeta, {
        reason: "read-side projection of an event-stream",
      });
    });
    expect(feature.rawTables).toHaveProperty("rt_probe");
    expect(feature.rawTables["rt_probe"]?.reason).toBe("read-side projection of an event-stream");
    expect(feature.rawTables["rt_probe"]?.meta).toBe(probeMeta);
  });

  test("two raw tables on one feature register under their tableName", () => {
    const feature = defineFeature("dual", (r) => {
      r.rawTable(probeMeta, { reason: "one" });
      r.rawTable(probeMetaTwo, { reason: "two" });
    });
    expect(Object.keys(feature.rawTables).sort()).toEqual(["rt_probe", "rt_probe_two"]);
  });

  test("absent rawTables on a feature is ok", () => {
    const feat = defineFeature("plain", () => {
      // no r.rawTable calls
    });
    expect(feat.rawTables).toEqual({});
  });
});

describe("createRegistry — rawTable aggregation", () => {
  test("aggregates raw tables across features and tags featureName", () => {
    const featA = defineFeature("billing", (r) => {
      r.rawTable(probeMeta, { reason: "external API cache" });
    });
    const featB = defineFeature("inventory", (r) => {
      r.rawTable(probeMetaTwo, { reason: "imported pre-ES" });
    });

    const registry = createRegistry([featA, featB]);
    const all = registry.getAllRawTables();

    expect(all.size).toBe(2);
    expect(all.get("rt_probe")?.featureName).toBe("billing");
    expect(all.get("rt_probe")?.reason).toBe("external API cache");
    expect(all.get("rt_probe_two")?.featureName).toBe("inventory");
  });

  test("rejects cross-feature tableName collisions at boot", () => {
    // Two features can't share the same physical tableName — migrate-runner
    // would race two CREATE TABLE statements. Boot-validator catches it.
    const featA = defineFeature("a", (r) => {
      r.rawTable(probeMeta, { reason: "first" });
    });
    const featB = defineFeature("b", (r) => {
      r.rawTable(probeMeta, { reason: "second" });
    });
    expect(() => createRegistry([featA, featB])).toThrow(
      /Raw-table "rt_probe" registered by both feature "a" and "b"/,
    );
  });

  test("two features with distinct tableNames register cleanly", () => {
    const featA = defineFeature("a", (r) => {
      r.rawTable(probeMeta, { reason: "first" });
    });
    const featB = defineFeature("b", (r) => {
      r.rawTable(probeMetaTwo, { reason: "second" });
    });
    expect(() => createRegistry([featA, featB])).not.toThrow();
  });

  test("rejects a raw-table that collides with an entity's physical name", () => {
    const widget = createEntity({ fields: { name: createTextField() } });
    // resolveTableName mirrors the migrate-runner — pin the exact physical name.
    const physical = resolveTableName("widget", widget, "shop");
    const clashing = defineUnmanagedTable({
      tableName: physical,
      columns: [{ name: "id", pgType: "text", notNull: true, primaryKey: true }],
    });
    const entityFeature = defineFeature("shop", (r) => {
      r.entity("widget", widget);
    });
    const tableFeature = defineFeature("other", (r) => {
      r.rawTable(clashing, { reason: "clash" });
    });

    // Entity registered first, then the colliding raw table.
    expect(() => createRegistry([entityFeature, tableFeature])).toThrow(
      new RegExp(`Raw-table "${physical}".*collides with the physical table of entity "widget"`),
    );

    // Order-independent: raw table registered first, then the entity.
    expect(() => createRegistry([tableFeature, entityFeature])).toThrow(
      new RegExp(`Entity "widget".*collides with r.rawTable\\("${physical}"\\)`),
    );
  });
});

describe("createRegistry — raw tables with PII-annotated fields (#820)", () => {
  const piiEntity = createEntity({
    table: "rt_pii_probe",
    fields: {
      userId: createTextField({ required: true }),
      ip: createTextField({ userOwned: { ownerField: "userId" } }),
    },
  });
  const piiMeta = buildEntityTableMeta("rt-pii-probe", piiEntity);

  test("buildEntityTableMeta records the subject-annotated field names", () => {
    expect(piiMeta.piiSubjectFields).toEqual(["ip"]);
  });

  test("rejects a PII-carrying raw table without piiEncryptedOnWrite", () => {
    const feat = defineFeature("probe", (r) => {
      r.rawTable(piiMeta, { reason: "direct-write store" });
    });
    expect(() => createRegistry([feat])).toThrow(
      /has PII-annotated fields \(ip\) but direct writes bypass the executor's PII encryption/,
    );
  });

  test("accepts it once the feature declares piiEncryptedOnWrite", () => {
    const feat = defineFeature("probe", (r) => {
      r.rawTable(piiMeta, {
        reason: "direct-write store",
        piiEncryptedOnWrite: true,
      });
    });
    expect(() => createRegistry([feat])).not.toThrow();
  });

  test("a PII-free raw table needs no declaration", () => {
    const feat = defineFeature("probe", (r) => {
      r.rawTable(probeMeta, { reason: "plain store" });
    });
    expect(() => createRegistry([feat])).not.toThrow();
  });
});
