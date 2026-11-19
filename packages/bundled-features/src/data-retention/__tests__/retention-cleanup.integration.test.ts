// Retention cleanup against real Postgres.
//
// Verifies not only that "old rows" are removed, but especially the negative
// cases where data-loss bugs hide:
//   - Rows WITHIN the retention period remain
//   - Rows belonging to ANOTHER tenant remain (perTenant scope)
//   - An entity WITHOUT a policy remains untouched
//   - A policy with a nonexistent reference column is skipped instead of causing
//     a mass delete
//
// Also covers the createdAt→insertedAt alias (the boot validator allows
// "createdAt", but the column is named inserted_at) and both active strategies
// (batched hardDelete, softDelete).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { asRawClient, buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import {
  bridgeStub,
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { runSeedWritesAt, SEED_MODE_ENV } from "@cosmicdrift/kumiko-framework/event-store";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { seedRowViaEventStore, waitFor, withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../feature.ts";
import { runRetentionCleanup } from "../run-retention-cleanup.ts";

// hardDelete, default-reference (createdAt → alias insertedAt → Spalte inserted_at).
const widgetEntity = createEntity({
  name: "c7-widget",
  table: "read_c7_widget",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "is_business_data" }),
  },
  // Retention runs as the framework system user: a locked row must still be hard-deleted.
  lockedWhen: { field: "label", eq: "expired-t1" },
  retention: { keepFor: "30d", strategy: "hardDelete" },
});

// softDelete strategy → sets is_deleted/deleted_at (the entity uses softDelete).
const gadgetEntity = createEntity({
  name: "c7-gadget",
  table: "read_c7_gadget",
  softDelete: true,
  fields: {
    label: createTextField({ required: true, personal: false, reason: "is_business_data" }),
  },
  // A locked row (label "expired") must still be soft-deleted by the system user.
  lockedWhen: { field: "label", eq: "expired" },
  retention: { keepFor: "30d", strategy: "softDelete" },
});

// No policy → must never be touched.
const plainEntity = createEntity({
  name: "c7-plain",
  table: "read_c7_plain",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "is_business_data" }),
  },
});

// reference="lastSeenAt" is valid at boot (Framework timestamp allowlist), but
// the column does not exist on this entity → the guard must skip it.
const staleEntity = createEntity({
  name: "c7-stale",
  table: "read_c7_stale",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "is_business_data" }),
  },
  retention: { keepFor: "30d", strategy: "hardDelete", reference: "lastSeenAt" },
});

// blockDelete represents a legal hold (HGB/GDPR presets: invoice/booking/
// contract). During keepFor, cleanup must IGNORE these rows (deleting them would
// violate the retention requirement); AFTER expiry, anonymize field functions
// run while the row remains and its link to a person is removed (fields.ts).
const retainedEntity = createEntity({
  name: "c7-retained",
  table: "read_c7_retained",
  fields: {
    // No subject flag on the old fixture either — anonymize alone has no
    // PersonalAnnotations arm, so this stays a spread instead of a direct
    // createTextField(...) override.
    label: {
      ...createTextField({ personal: false, reason: "test_fixture", required: true }),
      anonymize: () => "[ANONYMIZED]",
    },
  },
  retention: { keepFor: "30d", strategy: "blockDelete" },
});

// anonymize strategy: label is overwritten after expiry, while note has no
// anonymize function and must remain untouched (business data).
const anonEntity = createEntity({
  name: "c7-anon",
  table: "read_c7_anon",
  fields: {
    label: {
      ...createTextField({ personal: false, reason: "test_fixture", required: true }),
      anonymize: () => "[ANONYMIZED]",
    },
    note: createTextField({
      personal: false,
      reason: "is_business_data",
    }),
  },
  // The expired row is locked on purpose: the system user must still anonymise it.
  lockedWhen: { field: "note", eq: "business-note" },
  retention: { keepFor: "30d", strategy: "anonymize" },
});

// anonymize strategy WITHOUT anonymize fields — the runner cannot act and
// must report this as skipped rather than silently doing nothing.
const bareEntity = createEntity({
  name: "c7-bare",
  table: "read_c7_bare",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "is_business_data" }),
  },
  retention: { keepFor: "30d", strategy: "anonymize" },
});

// blockDelete without anonymize fields is a pure legal hold: nothing falls due
// after expiry, so no skipped entry (it would add log noise every cron run).
const bareHoldEntity = createEntity({
  name: "c7-barehold",
  table: "read_c7_barehold",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "is_business_data" }),
  },
  retention: { keepFor: "30d", strategy: "blockDelete" },
});

// blockDelete on an entity with a personal field but NO anonymize function:
// the person data would outlive the hold, so the cron must keep reporting it.
const personalHoldEntity = createEntity({
  name: "c7-personalhold",
  table: "read_c7_personalhold",
  fields: {
    label: createTextField({ personal: "self", find: "none", default: "" }),
  },
  retention: { keepFor: "30d", strategy: "blockDelete" },
});

// blockDelete on an entity whose only person link is a subjectRef: the field cannot carry
// anonymize (the user-data forget hook cuts it), so it is a pure hold, not a skip.
const subjectRefHoldEntity = createEntity({
  name: "c7-holdsubjectref",
  table: "read_c7_holdsubjectref",
  fields: {
    label: createTextField({ personal: "ref" }),
  },
  retention: { keepFor: "30d", strategy: "blockDelete" },
});

const c7Feature = defineFeature("c7-retention-fixtures", (r) => {
  r.entity(widgetEntity);
  r.entity(gadgetEntity);
  r.entity(plainEntity);
  r.entity(staleEntity);
  r.entity(retainedEntity);
  r.entity(anonEntity);
  r.entity(bareEntity);
  r.entity(bareHoldEntity);
  r.entity(personalHoldEntity);
  r.entity(subjectRefHoldEntity);
});

const noopLogger: JobContext["obs"]["log"] = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return noopLogger;
  },
};

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";

let stack: TestStack;
let now: ReturnType<ReturnType<typeof getTemporal>["Now"]["instant"]>;
let pastIso: string;
let withinIso: string;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createDataRetentionFeature(), c7Feature],
    jobs: { consumerLane: "worker", getActiveTenantIds: async () => [T1] },
  });
  for (const e of [
    tenantRetentionOverrideEntity,
    widgetEntity,
    gadgetEntity,
    plainEntity,
    staleEntity,
    retainedEntity,
    anonEntity,
    bareEntity,
  ]) {
    await unsafeCreateEntityTable(stack.db, e);
  }
  now = getTemporal().Now.instant();
  pastIso = now.subtract({ hours: 60 * 24 }).toString(); // 60d old → past cutoff
  withinIso = now.subtract({ hours: 10 * 24 }).toString(); // 10d alt → innerhalb
});

afterAll(async () => {
  await stack.cleanup();
});

// Back-dated create events give the row its inserted_at, the column the retention policy reads.
async function seedAt(
  entity: Parameters<typeof buildEntityTable>[0],
  values: Readonly<Record<string, unknown>>,
  insertedAtIso: string,
): Promise<void> {
  await withEnv({ [SEED_MODE_ENV]: "1" }, () =>
    runSeedWritesAt(getTemporal().Instant.from(insertedAtIso), () =>
      seedRowViaEventStore(stack.db, buildEntityTable(entity), values),
    ),
  );
}

function seed(
  entity: Parameters<typeof buildEntityTable>[0],
  tenantId: string,
  label: string,
  insertedAtIso: string,
): Promise<void> {
  return seedAt(entity, { tenantId, label }, insertedAtIso);
}

function seedAnonAt(label: string, note: string, insertedAtIso: string): Promise<void> {
  return seedAt(anonEntity, { tenantId: T1, label, note }, insertedAtIso);
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
  await resetEventStore(stack, [
    "read_c7_widget",
    "read_c7_gadget",
    "read_c7_plain",
    "read_c7_stale",
    "read_c7_retained",
    "read_c7_anon",
    "read_c7_bare",
    "read_c7_barehold",
    "read_c7_personalhold",
    "read_c7_holdsubjectref",
  ]);
});

describe("runRetentionCleanup :: real postgres", () => {
  test("hardDelete removes only expired rows of the tenant, keeps fresh rows + other tenant", async () => {
    await seed(widgetEntity, T1, "expired-t1", pastIso);
    await seed(widgetEntity, T1, "fresh-t1", withinIso);
    await seed(widgetEntity, T2, "expired-t2", pastIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
    });

    expect(result.hardDeleted).toBe(1);
    expect(await labels("read_c7_widget", T1)).toEqual(["fresh-t1"]); // within bleibt
    expect(await labels("read_c7_widget", T2)).toEqual(["expired-t2"]); // Fremd-Tenant bleibt
  });

  test("softDelete markiert abgelaufene Rows, frische bleiben live", async () => {
    await seed(gadgetEntity, T1, "expired", pastIso);
    await seed(gadgetEntity, T1, "fresh", withinIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
    });

    expect(result.softDeleted).toBe(1);
    expect(await liveGadgetLabels(T1)).toEqual(["fresh"]);
    // Row still exists physically (only is_deleted=true).
    expect(await labels("read_c7_gadget", T1)).toEqual(["expired", "fresh"]);
  });

  test("Entity without a policy remains completely untouched", async () => {
    await seed(plainEntity, T1, "ancient", pastIso);

    await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
    });

    expect(await labels("read_c7_plain", T1)).toEqual(["ancient"]);
  });

  test("missing reference column → skip instead of mass delete", async () => {
    await seed(staleEntity, T1, "should-survive", pastIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
    });

    expect(await labels("read_c7_stale", T1)).toEqual(["should-survive"]);
    expect(result.skipped).toContainEqual({
      entityName: "c7-stale",
      reason: "missing_reference_column",
    });
    expect(result.hardDeleted).toBe(0);
  });

  test("the registered job handler resolves ctx.systemUser.tenantId and actually cleans up (not runRetentionCleanup called directly)", async () => {
    // cleanup-cron-registration.test.ts only pins job metadata; runRetentionCleanup
    // tests above call it directly, bypassing the handler body entirely — a bug in
    // the ctx.systemUser?.tenantId ?? ctx.user.tenantId resolution or the throw-guard
    // would be invisible to both. Invoke the ACTUAL registered handler.
    await seed(widgetEntity, T1, "expired-via-handler", pastIso);
    await seed(widgetEntity, T1, "fresh-via-handler", withinIso);

    const job = stack.registry.getJob("data-retention:job:retention-cleanup");
    expect(job).toBeDefined();
    if (!job) return;

    const ctx: JobContext = {
      db: createTenantDb({
        db: stack.db,
        tenantId: T1,
        mode: "tenant",
        grants: {
          unsafeRaw: {
            reason: "per-tenant fan-out cleanup using raw helpers",
            grants: ["unsafeRaw"],
          },
        },
      }),
      registry: stack.registry,
      systemUser: { id: "system", tenantId: T1, roles: ["all"] },
      triggeredBy: null,
      attempt: 1,
      finalAttempt: true,
      defer: (delayMs) => ({ kind: "job-deferral", delayMs }),
      canDefer: false,
      ...bridgeStub({ log: noopLogger }),
    };
    await job.handler({}, ctx);

    expect(await labels("read_c7_widget", T1)).toEqual(["fresh-via-handler"]);
  });

  test("the job dispatched through the job runner hard-deletes past the irreversible-operation gate", async () => {
    await seed(widgetEntity, T1, "expired-via-runner", pastIso);
    await seed(widgetEntity, T1, "fresh-via-runner", withinIso);

    await stack.jobRunner?.dispatch("data-retention:job:retention-cleanup", {});
    await waitFor(async () => {
      expect(await labels("read_c7_widget", T1)).toEqual(["fresh-via-runner"]);
    });
  });

  test("blockDelete: within keepFor untouched, after expiry anonymized — row NEVER deleted", async () => {
    await seed(retainedEntity, T1, "in-hold", withinIso);
    await seed(retainedEntity, T1, "hold-expired", pastIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
    });

    // Beide Rows physisch da — blockDelete darf NIE loeschen.
    expect((await labels("read_c7_retained", T1)).sort()).toEqual(["[ANONYMIZED]", "in-hold"]);
    expect(result.hardDeleted).toBe(0);
    expect(result.softDeleted).toBe(0);
    expect(result.anonymized).toBe(1);
  });

  test("anonymize: expired row gets field functions applied, other fields + fresh rows untouched", async () => {
    await seedAnonAt("old-pii", "business-note", pastIso);
    await seedAnonAt("fresh-pii", "fresh-note", withinIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
    });

    expect(result.anonymized).toBe(1);
    const rows = (await asRawClient(stack.db).unsafe(
      `SELECT label, note FROM read_c7_anon WHERE tenant_id = $1 ORDER BY note`,
      [T1],
    )) as { label: string; note: string }[];
    expect(rows).toEqual([
      { label: "[ANONYMIZED]", note: "business-note" }, // PII raus, Geschaeftsdaten bleiben
      { label: "fresh-pii", note: "fresh-note" }, // innerhalb keepFor: unangetastet
    ]);
  });

  test("anonymize is idempotent: second run appends ZERO events (no daily event spam)", async () => {
    await seedAnonAt("old-pii", "n", pastIso);

    const first = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
    });
    expect(first.anonymized).toBe(1);

    const eventsAfterFirst = (await asRawClient(stack.db).unsafe(
      `SELECT count(*)::int AS n FROM kumiko_events`,
    )) as { n: number }[];

    const second = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
    });
    expect(second.anonymized).toBe(0);

    const eventsAfterSecond = (await asRawClient(stack.db).unsafe(
      `SELECT count(*)::int AS n FROM kumiko_events`,
    )) as { n: number }[];
    expect(eventsAfterSecond[0]?.n).toBe(eventsAfterFirst[0]?.n);
  });

  test("anonymize converges under batchLimit=1: cursor pages past already-anonymized rows", async () => {
    for (const label of ["a-pii", "b-pii", "c-pii"]) {
      await seedAnonAt(label, `note-${label}`, pastIso);
    }

    const run = () =>
      runRetentionCleanup({
        db: stack.db,
        registry: stack.registry,
        tenantId: T1,
        preloadedTenantPreset: null,
        now,
        batchLimit: 1,
      });

    expect((await run()).anonymized).toBe(1);
    expect((await run()).anonymized).toBe(1); // Cursor must advance past the already-processed row
    expect((await run()).anonymized).toBe(1);
    expect((await run()).anonymized).toBe(0); // konvergiert

    const rows = (await asRawClient(stack.db).unsafe(
      `SELECT label FROM read_c7_anon WHERE tenant_id = $1`,
      [T1],
    )) as { label: string }[];
    expect(rows.map((r) => r.label)).toEqual(["[ANONYMIZED]", "[ANONYMIZED]", "[ANONYMIZED]"]);
  });

  test("anonymize strategy without anonymize fields → skipped with reason, rows untouched", async () => {
    await seed(bareEntity, T1, "survives", pastIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
    });

    expect(await labels("read_c7_bare", T1)).toEqual(["survives"]);
    expect(result.skipped).toContainEqual({
      entityName: "c7-bare",
      reason: "missing_anonymize_fields",
    });
  });

  test("blockDelete without anonymize fields → no skipped entry, rows untouched", async () => {
    await seed(bareHoldEntity, T1, "survives", pastIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
    });

    expect(await labels("read_c7_barehold", T1)).toEqual(["survives"]);
    expect(result.skipped.map((s) => s.entityName)).not.toContain("c7-barehold");
  });

  test("blockDelete with only a subjectRef field → pure hold, no skipped entry, rows untouched", async () => {
    await seed(subjectRefHoldEntity, T1, "survives", pastIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
    });

    expect(await labels("read_c7_holdsubjectref", T1)).toEqual(["survives"]);
    expect(result.skipped.map((s) => s.entityName)).not.toContain("c7-holdsubjectref");
  });

  test("blockDelete with a personal field but no anonymize function → still skipped missing_anonymize_fields", async () => {
    await seed(personalHoldEntity, T1, "survives", pastIso);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: T1,
      preloadedTenantPreset: null,
      now,
    });

    expect(await labels("read_c7_personalhold", T1)).toEqual(["survives"]);
    expect(result.skipped).toContainEqual({
      entityName: "c7-personalhold",
      reason: "missing_anonymize_fields",
    });
  });
});
