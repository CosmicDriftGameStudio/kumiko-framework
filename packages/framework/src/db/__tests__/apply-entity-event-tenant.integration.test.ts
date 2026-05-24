// Direkte Tests für applyEntityEvent's tenantId-Defaulting. Zwei
// Branches (siehe apply-entity-event.ts:created):
//
//   - payload.tenantId GESETZT → wins (z.B. seedTenantMembership-Pfad
//     wo Operator tenantId und Ziel-tenantId divergieren)
//   - payload.tenantId NICHT gesetzt → Fallback auf event.tenantId
//     (Replay-Fall für entity-Tabellen ohne tenantId-Feld)
//
// Beide Branches werden indirekt durch andere Tests berührt
// (seedTenantMembership-Integration für A, Live==Rebuild für B), aber
// kein expliziter Test pinst das exakte Verhalten von applyEntityEvent.
// Wenn jemand die Spread-Reihenfolge im values()-Object umdreht
// (`...event.payload, tenantId: event.tenantId` statt
// `tenantId: event.tenantId, ...event.payload`), würde Branch A still
// zerbrechen — der bestehende seed-Test wäre der einzige Catcher, und
// der lief vor dem Refactor durch Zufall grün.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { asRawClient, selectMany } from "../../db/query";
import { createEntity, createTextField } from "../../engine/factories";
import type { TenantId } from "../../engine/types";
import type { StoredEvent } from "../../event-store";
import { createEventsTable } from "../../event-store";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { applyEntityEvent } from "../apply-entity-event";
import { buildEntityTable } from "../table-builder";

const entity = createEntity({
  table: "read_apply_tenant_check",
  fields: {
    name: createTextField({ required: true }),
  },
});
const table = buildEntityTable("apply-tenant-check", entity);

let testDb: BunTestDb;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
  await asRawClient(testDb.db).unsafe(`
    CREATE TABLE read_apply_tenant_check (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      version integer NOT NULL DEFAULT 1,
      inserted_at timestamptz NOT NULL DEFAULT now(),
      modified_at timestamptz,
      inserted_by_id text,
      modified_by_id text,
      name text NOT NULL
    )
  `);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(`TRUNCATE read_apply_tenant_check`);
});

const TENANT_OPERATOR = "11111111-1111-1111-1111-111111111111" as TenantId;
const TENANT_TARGET = "22222222-2222-2222-2222-222222222222" as TenantId;

function syntheticCreateEvent(payload: Record<string, unknown>): StoredEvent {
  return {
    id: "evt-1",
    aggregateId: "33333333-3333-3333-3333-333333333333",
    aggregateType: "apply-tenant-check",
    tenantId: TENANT_OPERATOR,
    version: 1,
    type: "apply-tenant-check.created",
    eventVersion: 1,
    payload,
    metadata: { userId: "u-1" },
    createdAt: { toString: () => "2026-04-27T00:00:00Z" } as never,
    createdBy: "u-1",
  };
}

describe("applyEntityEvent — tenantId-Defaulting", () => {
  test("payload OHNE tenantId → row.tenantId fällt auf event.tenantId zurück (Replay-Default)", async () => {
    const event = syntheticCreateEvent({ name: "without-tenantId-in-payload" });
    const result = await applyEntityEvent(event, table, entity, testDb.db);
    expect(result.kind).toBe("applied");

    const [row] = await selectMany(testDb.db, table, { id: event.aggregateId });
    expect(row?.["tenantId"]).toBe(TENANT_OPERATOR);
    expect(row?.["name"]).toBe("without-tenantId-in-payload");
  });

  test("payload MIT tenantId überschreibt event.tenantId (seed-Override-Case)", async () => {
    // seedTenantMembership-Realität: Operator (event.tenantId =
    // OPERATOR) schreibt eine Membership in den Ziel-Tenant (payload
    // .tenantId = TARGET). Der Row gehört in den Ziel-Tenant.
    const event = syntheticCreateEvent({
      name: "tenantId-override",
      tenantId: TENANT_TARGET,
    });
    const result = await applyEntityEvent(event, table, entity, testDb.db);
    expect(result.kind).toBe("applied");

    const [row] = await selectMany(testDb.db, table, { id: event.aggregateId });
    expect(row?.["tenantId"]).toBe(TENANT_TARGET);
    expect(row?.["tenantId"]).not.toBe(TENANT_OPERATOR);
  });

  test("payload.tenantId === '' (empty string) → wirft (fail-loud, kein silent fallback)", async () => {
    // Tenant-isolation-kritisch: silent fallback auf event.tenantId
    // würde eine Bug-payload (Form-Input ohne Trim-Check, defekter
    // Hook etc.) in den Operator-Tenant schreiben, obwohl der
    // Caller-Code die Row in irgendeinen Ziel-Tenant routen wollte.
    // Cross-Tenant-Drift. Fail-loud ist die einzige Wahl.
    const event = syntheticCreateEvent({
      name: "empty-tenantId",
      tenantId: "",
    });
    await expect(applyEntityEvent(event, table, entity, testDb.db)).rejects.toThrow(
      /payload\.tenantId set but invalid/,
    );
  });

  test("payload.tenantId === null → wirft (fail-loud)", async () => {
    // Spiegel-Case. JSON-Payload kann literal null tragen (Hook der
    // einen Wert auf null gesetzt hat statt zu unsetten). Auch hier
    // kein silent fallback — tenant-isolation-kritisch.
    const event = syntheticCreateEvent({
      name: "null-tenantId",
      tenantId: null,
    });
    await expect(applyEntityEvent(event, table, entity, testDb.db)).rejects.toThrow(
      /payload\.tenantId set but invalid/,
    );
  });

  test("Spread-Reihenfolge: payload-Felder bleiben erhalten, framework-Defaults nicht überschrieben", async () => {
    // Negative-Anchor: id/version/insertedAt/insertedById dürfen NICHT
    // aus dem payload kommen (kommen vom event). Wenn jemand die
    // Reihenfolge im values() umstellt, würde dieser Test fangen.
    const event = syntheticCreateEvent({
      name: "spread-order-check",
      // Diese Felder im payload müssen vom framework überschrieben werden:
      id: "00000000-0000-0000-0000-000000000000",
      version: 999,
      insertedById: "fake-user",
    });
    const result = await applyEntityEvent(event, table, entity, testDb.db);
    expect(result.kind).toBe("applied");

    const [row] = await selectMany(testDb.db, table, { id: event.aggregateId });
    // event.aggregateId wins, nicht payload.id
    expect(row?.["id"]).toBe(event.aggregateId);
    // event.version wins, nicht payload.version
    expect(row?.["version"]).toBe(event.version);
    // event.createdBy wins, nicht payload.insertedById
    expect(row?.["insertedById"]).toBe(event.createdBy);
  });
});
