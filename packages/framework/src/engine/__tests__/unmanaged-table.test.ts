// Unit tests for r.unmanagedTable() — the EntityTableMeta cousin of
// r.rawTable. Same audit-trail contract, different storage shape (post-
// drizzle migrate-runner). See define-feature.ts / DX-4.

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
  tableName: "ut_probe",
  columns: [{ name: "id", pgType: "text", notNull: true, primaryKey: true }],
});
const probeMetaTwo = defineUnmanagedTable({
  tableName: "ut_probe_two",
  columns: [{ name: "id", pgType: "text", notNull: true, primaryKey: true }],
});

describe("r.unmanagedTable — declaration", () => {
  test("rejects duplicate registrations within one feature", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.unmanagedTable(probeMeta, { reason: "test" });
        r.unmanagedTable(probeMeta, { reason: "test" });
      }),
    ).toThrow(/already registered/);
  });

  test("rejects empty reason", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.unmanagedTable(probeMeta, { reason: "" });
      }),
    ).toThrow(/options\.reason must be a non-empty string/);
  });

  test("rejects whitespace-only reason", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.unmanagedTable(probeMeta, { reason: "   " });
      }),
    ).toThrow(/options\.reason must be a non-empty string/);
  });

  test("accepts valid registration and stores meta + reason", () => {
    const feature = defineFeature("probe", (r) => {
      r.unmanagedTable(probeMeta, {
        reason: "read-side projection of an event-stream",
      });
    });
    expect(feature.unmanagedTables).toHaveProperty("ut_probe");
    expect(feature.unmanagedTables["ut_probe"]?.reason).toBe(
      "read-side projection of an event-stream",
    );
    expect(feature.unmanagedTables["ut_probe"]?.meta).toBe(probeMeta);
  });

  test("two unmanaged tables on one feature register under their tableName", () => {
    const feature = defineFeature("dual", (r) => {
      r.unmanagedTable(probeMeta, { reason: "one" });
      r.unmanagedTable(probeMetaTwo, { reason: "two" });
    });
    expect(Object.keys(feature.unmanagedTables).sort()).toEqual(["ut_probe", "ut_probe_two"]);
  });

  test("absent unmanagedTables on a feature is ok", () => {
    const feat = defineFeature("plain", () => {
      // no r.unmanagedTable calls
    });
    expect(feat.unmanagedTables).toEqual({});
  });
});

describe("createRegistry — unmanagedTable aggregation", () => {
  test("rejects cross-feature tableName collisions at boot", () => {
    // Two features can't share the same physical tableName — migrate-runner
    // would race two CREATE TABLE statements. Boot-validator catches it.
    const featA = defineFeature("a", (r) => {
      r.unmanagedTable(probeMeta, { reason: "first" });
    });
    const featB = defineFeature("b", (r) => {
      r.unmanagedTable(probeMeta, { reason: "second" });
    });
    expect(() => createRegistry([featA, featB])).toThrow(
      /Unmanaged-table "ut_probe" registered by both feature "a" and "b"/,
    );
  });

  test("two features with distinct tableNames register cleanly", () => {
    const featA = defineFeature("a", (r) => {
      r.unmanagedTable(probeMeta, { reason: "first" });
    });
    const featB = defineFeature("b", (r) => {
      r.unmanagedTable(probeMetaTwo, { reason: "second" });
    });
    expect(() => createRegistry([featA, featB])).not.toThrow();
  });

  test("rejects an unmanaged-table that collides with an entity's physical name", () => {
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
      r.unmanagedTable(clashing, { reason: "clash" });
    });

    // Entity registered first, then the colliding unmanaged table.
    expect(() => createRegistry([entityFeature, tableFeature])).toThrow(
      new RegExp(
        `Unmanaged-table "${physical}".*collides with the physical table of entity "widget"`,
      ),
    );

    // Order-independent: unmanaged table registered first, then the entity.
    expect(() => createRegistry([tableFeature, entityFeature])).toThrow(
      new RegExp(`Entity "widget".*collides with r.unmanagedTable\\("${physical}"\\)`),
    );
  });
});

describe("createRegistry — unmanaged tables with PII-annotated fields (#820)", () => {
  const piiEntity = createEntity({
    table: "ut_pii_probe",
    fields: {
      userId: createTextField({ required: true }),
      ip: createTextField({ userOwned: { ownerField: "userId" } }),
    },
  });
  const piiMeta = buildEntityTableMeta("ut-pii-probe", piiEntity);

  test("buildEntityTableMeta records the subject-annotated field names", () => {
    expect(piiMeta.piiSubjectFields).toEqual(["ip"]);
  });

  test("rejects a PII-carrying unmanaged table without piiEncryptedOnWrite", () => {
    const feat = defineFeature("probe", (r) => {
      r.unmanagedTable(piiMeta, { reason: "direct-write store" });
    });
    expect(() => createRegistry([feat])).toThrow(
      /has PII-annotated fields \(ip\) but direct writes bypass the executor's PII encryption/,
    );
  });

  test("accepts it once the feature declares piiEncryptedOnWrite", () => {
    const feat = defineFeature("probe", (r) => {
      r.unmanagedTable(piiMeta, {
        reason: "direct-write store",
        piiEncryptedOnWrite: true,
      });
    });
    expect(() => createRegistry([feat])).not.toThrow();
  });

  test("a PII-free unmanaged table needs no declaration", () => {
    const feat = defineFeature("probe", (r) => {
      r.unmanagedTable(probeMeta, { reason: "plain store" });
    });
    expect(() => createRegistry([feat])).not.toThrow();
  });
});
