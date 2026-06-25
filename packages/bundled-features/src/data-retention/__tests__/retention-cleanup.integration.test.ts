// S2.D2b — retention-cleanup gegen echtes Postgres.
//
// Verifiziert NICHT nur "alte Rows weg", sondern vor allem die Negativ-Faelle,
// in denen sich Datenverlust-Bugs verstecken:
//   - Rows INNERHALB der Retention bleiben
//   - Rows eines ANDEREN Tenants bleiben (perTenant-Scope)
//   - Entity OHNE Policy bleibt unangetastet
//   - Policy mit nicht-existenter reference-Spalte → skip statt Mass-Delete
//
// Deckt zudem den createdAt→insertedAt-Alias (Boot-Validator erlaubt
// "createdAt", die Spalte heisst aber inserted_at) und beide aktiven
// Strategien (hardDelete batched, softDelete).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../feature";
import { runRetentionCleanup } from "../run-retention-cleanup";

// hardDelete, default-reference (createdAt → alias insertedAt → Spalte inserted_at).
const widgetEntity = createEntity({
  table: "read_c7_widget",
  fields: { label: createTextField({ required: true }) },
  retention: { keepFor: "30d", strategy: "hardDelete" },
});

// softDelete-Strategy → setzt is_deleted/deleted_at (Entity ist softDelete).
const gadgetEntity = createEntity({
  table: "read_c7_gadget",
  softDelete: true,
  fields: { label: createTextField({ required: true }) },
  retention: { keepFor: "30d", strategy: "softDelete" },
});

// Keine Policy → darf nie angefasst werden.
const plainEntity = createEntity({
  table: "read_c7_plain",
  fields: { label: createTextField({ required: true }) },
});

// reference="lastSeenAt" ist Boot-valide (Framework-Timestamp-Allowlist), aber
// die Spalte existiert auf diesem Entity nicht → Guard muss skippen.
const staleEntity = createEntity({
  table: "read_c7_stale",
  fields: { label: createTextField({ required: true }) },
  retention: { keepFor: "30d", strategy: "hardDelete", reference: "lastSeenAt" },
});

const c7Feature = defineFeature("c7-retention-fixtures", (r) => {
  r.entity("c7-widget", widgetEntity);
  r.entity("c7-gadget", gadgetEntity);
  r.entity("c7-plain", plainEntity);
  r.entity("c7-stale", staleEntity);
});

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";

let stack: TestStack;
let now: ReturnType<ReturnType<typeof getTemporal>["Now"]["instant"]>;
let pastIso: string;
let withinIso: string;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createDataRetentionFeature(), c7Feature] });
  for (const e of [
    tenantRetentionOverrideEntity,
    widgetEntity,
    gadgetEntity,
    plainEntity,
    staleEntity,
  ]) {
    await unsafeCreateEntityTable(stack.db, e);
  }
  now = getTemporal().Now.instant();
  pastIso = now.subtract({ hours: 60 * 24 }).toString(); // 60d alt → ueber Cutoff
  withinIso = now.subtract({ hours: 10 * 24 }).toString(); // 10d alt → innerhalb
});

afterAll(async () => {
  await stack.cleanup();
});

async function seed(table: string, tenantId: string, label: string, insertedAtIso: string) {
  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${table} (tenant_id, label, inserted_at) VALUES ($1, $2, $3::timestamptz)`,
    [tenantId, label, insertedAtIso],
  );
}

async function labels(table: string, tenantId: string): Promise<string[]> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT label FROM ${table} WHERE tenant_id = $1 ORDER BY label`,
    [tenantId],
  )) as { label: string }[];
  return rows.map((r) => r.label);
}

async function liveGadgetLabels(tenantId: string): Promise<string[]> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT label FROM read_c7_gadget WHERE tenant_id = $1 AND is_deleted = false ORDER BY label`,
    [tenantId],
  )) as { label: string }[];
  return rows.map((r) => r.label);
}

beforeEach(async () => {
  for (const t of ["read_c7_widget", "read_c7_gadget", "read_c7_plain", "read_c7_stale"]) {
    await asRawClient(stack.db).unsafe(`DELETE FROM ${t}`);
  }
});

describe("runRetentionCleanup :: real postgres", () => {
  test("hardDelete entfernt nur abgelaufene Rows DES Tenants, behaelt frische + Fremd-Tenant", async () => {
    await seed("read_c7_widget", T1, "expired-t1", pastIso);
    await seed("read_c7_widget", T1, "fresh-t1", withinIso);
    await seed("read_c7_widget", T2, "expired-t2", pastIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      tenantPreset: null,
      now,
    });

    expect(result.hardDeleted).toBe(1);
    expect(await labels("read_c7_widget", T1)).toEqual(["fresh-t1"]); // within bleibt
    expect(await labels("read_c7_widget", T2)).toEqual(["expired-t2"]); // Fremd-Tenant bleibt
  });

  test("softDelete markiert abgelaufene Rows, frische bleiben live", async () => {
    await seed("read_c7_gadget", T1, "expired", pastIso);
    await seed("read_c7_gadget", T1, "fresh", withinIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      tenantPreset: null,
      now,
    });

    expect(result.softDeleted).toBe(1);
    expect(await liveGadgetLabels(T1)).toEqual(["fresh"]);
    // Row physisch noch da (nur is_deleted=true).
    expect(await labels("read_c7_gadget", T1)).toEqual(["expired", "fresh"]);
  });

  test("Entity ohne Policy bleibt komplett unangetastet", async () => {
    await seed("read_c7_plain", T1, "ancient", pastIso);

    await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      tenantPreset: null,
      now,
    });

    expect(await labels("read_c7_plain", T1)).toEqual(["ancient"]);
  });

  test("fehlende reference-Spalte → skip statt Mass-Delete", async () => {
    await seed("read_c7_stale", T1, "should-survive", pastIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      tenantPreset: null,
      now,
    });

    expect(await labels("read_c7_stale", T1)).toEqual(["should-survive"]);
    expect(result.skipped).toContainEqual({
      entityName: "c7-stale",
      reason: "missing_reference_column",
    });
    expect(result.hardDeleted).toBe(0);
  });
});
