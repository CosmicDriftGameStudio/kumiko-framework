// Unit tests for r.rawTable() — declaration-time validation + registry
// aggregation. Full DB roundtrip (setupTestStack pushes the table → INSERT
// / SELECT) lives in src/__tests__/raw-table.integration.ts.

import { pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import type { SchemaTable } from "../../db/dialect";
import { defineFeature } from "../define-feature";
import { createRegistry } from "../registry";
import type { ProjectionDefinition } from "../types";

const probeTable = pgTable("rt_probe_table", {
  id: text("id").primaryKey(),
});
const probeTableTwo = pgTable("rt_probe_table_two", {
  id: text("id").primaryKey(),
});

describe("r.rawTable — declaration", () => {
  test("rejects non-kebab-case names", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.rawTable("BadName", probeTable, { reason: "test" });
      }),
    ).toThrow(/must be kebab-case/);
  });

  test("rejects duplicate names within one feature", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.rawTable("cache", probeTable, { reason: "test" });
        r.rawTable("cache", probeTableTwo, { reason: "test" });
      }),
    ).toThrow(/already registered/);
  });

  test("rejects empty reason", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.rawTable("cache", probeTable, { reason: "" });
      }),
    ).toThrow(/options\.reason must be a non-empty string/);
  });

  test("rejects whitespace-only reason", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.rawTable("cache", probeTable, { reason: "   " });
      }),
    ).toThrow(/options\.reason must be a non-empty string/);
  });

  test("accepts valid registration and stores reason verbatim", () => {
    const feature = defineFeature("probe", (r) => {
      r.rawTable("cache", probeTable, {
        reason: "external Stripe webhook cache, write-only by webhook handler",
      });
    });
    expect(feature.rawTables).toHaveProperty("cache");
    expect(feature.rawTables["cache"]?.reason).toBe(
      "external Stripe webhook cache, write-only by webhook handler",
    );
    expect(feature.rawTables["cache"]?.table).toBe(probeTable);
  });
});

describe("createRegistry — rawTable aggregation", () => {
  test("aggregates raw tables across features and tags featureName", () => {
    const featA = defineFeature("billing", (r) => {
      r.rawTable("stripe-cache", probeTable, { reason: "external API cache" });
    });
    const featB = defineFeature("inventory", (r) => {
      r.rawTable("legacy-import", probeTableTwo, { reason: "imported pre-ES" });
    });

    const registry = createRegistry([featA, featB]);
    const all = registry.getAllRawTables();

    expect(all.size).toBe(2);
    expect(all.get("stripe-cache")?.featureName).toBe("billing");
    expect(all.get("stripe-cache")?.reason).toBe("external API cache");
    expect(all.get("legacy-import")?.featureName).toBe("inventory");
  });

  test("rejects cross-feature name collisions at boot", () => {
    const featA = defineFeature("a", (r) => {
      r.rawTable("shared", probeTable, { reason: "first" });
    });
    const featB = defineFeature("b", (r) => {
      r.rawTable("shared", probeTableTwo, { reason: "second" });
    });

    expect(() => createRegistry([featA, featB])).toThrow(
      /Raw-table "shared" registered by both feature "a" and "b"/,
    );
  });

  test("absent rawTables block on a feature is ok (legacy / hand-built features)", () => {
    const featNoRaw = defineFeature("no-raw", () => {
      // no r.rawTable calls
    });
    const registry = createRegistry([featNoRaw]);
    expect(registry.getAllRawTables().size).toBe(0);
  });

  test("two raw tables on the same PgTable register under both names", () => {
    // Different logical names, identical physical target — legitimate
    // when one role writes (primary cache) and a second role reads
    // (alias view). Push-time dedupe keeps the boot to a single CREATE;
    // the registry keeps both entries so callers can resolve either name.
    const sharedT = pgTable("rt_shared_dedupe", {
      id: text("id").primaryKey(),
    }) as unknown as SchemaTable;
    const feat = defineFeature("dedupe", (r) => {
      r.rawTable("primary", sharedT, { reason: "main writer" });
      r.rawTable("alias", sharedT, { reason: "alias for read consumers" });
    });
    const registry = createRegistry([feat]);

    expect(registry.getAllRawTables().size).toBe(2);
    expect(registry.getAllRawTables().get("primary")?.table).toBe(sharedT);
    expect(registry.getAllRawTables().get("alias")?.table).toBe(sharedT);
  });

  test("rejects rawTable that shares a PgTable with an explicit projection", () => {
    // A r.rawTable() declaring the same physical table as a registered
    // r.projection() is almost always an authoring bug — two owners on
    // the same physical table, one event-sourced, one bypass. Boot
    // throws so the failure points at the misconfiguration site.
    const sharedT = pgTable("rt_collision_phys", {
      id: text("id").primaryKey(),
    }) as unknown as SchemaTable;
    const projection: ProjectionDefinition = {
      name: "shared-summary",
      source: "shared",
      table: sharedT,
      apply: {},
    };
    const featProj = defineFeature("proj-owner", (r) => {
      r.projection(projection);
    });
    const featRaw = defineFeature("raw-owner", (r) => {
      r.rawTable("collision", sharedT, { reason: "intentionally bad" });
    });

    expect(() => createRegistry([featProj, featRaw])).toThrow(
      /shares a Drizzle PgTable with a registered projection/,
    );
  });
});
