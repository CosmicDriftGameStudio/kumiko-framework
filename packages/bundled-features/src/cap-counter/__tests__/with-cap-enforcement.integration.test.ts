// Integration-test for withCapEnforcement / withRollingCapEnforcement.
// Beweist die Wrapper-Verdrahtung end-to-end:
//   1. Pre-call: enforceCapAndMaybeNotify dispatched (notifier feuert,
//      mark-soft-warned-handler kippt das DB-Flag)
//   2. Handler runs — only when below hard-cap
//   3. Atomic reservation before the handler — counter steigt um `amount`
//   4. Hard-hit: handler runs NICHT, counter NICHT inkrementiert
//   5. Failed handler: counter NICHT inkrementiert (cap-quota nicht
//      verbrannt für gescheiterte writes)

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { asRawClient, createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineFeature,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { capCounterAggregateId } from "../aggregate-id.js";
import { bookCapUsage, markCapSoftWarned, readRollingCapUsage } from "../book-cap-usage.js";
import { CapCounterHandlers, CapCounterQueries } from "../constants.js";
import type { SoftHitNotifier } from "../enforce-cap.js";
import { capCounterEntity } from "../entity.js";
import { capCounterFeature } from "../feature.js";
import { withCapEnforcement, withRollingCapEnforcement } from "../with-cap-enforcement.js";

// =============================================================================
// Test-Probe — newsletter-send-Handler with cap-enforcement
// =============================================================================
//
// Module-level state für die Tests:
//   - sendCallCount: wie oft der gewrappte Handler tatsächlich gerufen wurde
//     (Drift-Pin: bei hard-hit darf das NICHT inkrementieren)
//   - recordedNotifications: Notifier-callback firings
//   - failNextSend: simuliert handler-Fehler — Drift-Pin: Counter darf
//     bei failure nicht inkrementieren
let sendCallCount = 0;
let failNextSend = false;
const recordedNotifications: Array<{ capName: string; value: number }> = [];
const recordingNotifier: SoftHitNotifier = (info) => {
  recordedNotifications.push({ capName: info.capName, value: info.value });
};

const innerSendHandler: WriteHandlerDef = {
  name: "send-newsletter",
  schema: z.object({ to: z.string() }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (_event, _ctx) => {
    sendCallCount += 1;
    if (failNextSend) {
      failNextSend = false;
      throw new Error("send-failed-on-purpose");
    }
    return { isSuccess: true as const, data: { sent: true } };
  },
};

const PERIOD = "2026-07-01T00:00:00Z";

const { table: capCounterTable } = createEntityExecutor("cap-counter", capCounterEntity);

const wrappedCalendar = withCapEnforcement(innerSendHandler, () => ({
  capName: "newsletter-cap",
  periodStartIso: PERIOD,
  limit: 5,
  profile: "burstable",
  notify: recordingNotifier,
}));

const wrappedRolling = withRollingCapEnforcement(
  { ...innerSendHandler, name: "send-rolling" },
  () => ({
    capName: "newsletter-rolling-cap",
    windowDays: 7,
    limit: 5,
    profile: "burstable",
    notify: recordingNotifier,
  }),
);

const NEWSLETTER_QN = "newsletter:write:send-newsletter";
const NEWSLETTER_ROLLING_QN = "newsletter:write:send-rolling";

// =============================================================================
// TenantAdmin-only probes (fw#2854 gap): the users above carry BOTH
// TenantAdmin and SystemAdmin, which hid the bug that enforceCapAndMaybeNotify
// / withCapEnforcement / withRollingCapEnforcement used to dispatch
// SystemAdmin-only handlers (ctx.write(CapCounterHandlers.increment) etc.) —
// a plain TenantAdmin caller with no escapeHatch would have gotten
// access_denied. These handlers carry ONLY TenantAdmin and no escapeHatch,
// proving the in-process booking helpers (book-cap-usage.ts) work for
// ordinary tenant callers.
// =============================================================================

const tenantOnlyInnerHandler: WriteHandlerDef = {
  name: "send-newsletter-tenant-only",
  schema: z.object({ to: z.string() }),
  access: { roles: ["TenantAdmin"] },
  handler: async (_event, _ctx) => ({ isSuccess: true as const, data: { sent: true } }),
};

const TENANT_ONLY_PERIOD = "2026-08-01T00:00:00Z";

const wrappedCalendarTenantOnly = withCapEnforcement(tenantOnlyInnerHandler, () => ({
  capName: "newsletter-cap-tenant-only",
  periodStartIso: TENANT_ONLY_PERIOD,
  limit: 10,
  profile: "burstable",
  notify: recordingNotifier,
}));

const OUTSIDE_TX_CAP_NAME = "outside-tx-booking-cap";
const bookOutsideTxThenFailHandler: WriteHandlerDef = {
  name: "book-outside-tx-then-fail",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: async (_event, ctx) => {
    await bookCapUsage(ctx, {
      capName: OUTSIDE_TX_CAP_NAME,
      periodStartIso: TENANT_ONLY_PERIOD,
      outsideTransaction: true,
    });
    throw new Error("boom-after-booking");
  },
};

const ATOMIC_CAP_LIMIT = 3;
const ATOMIC_CAP_NAME = "atomic-hard-slot-cap";
let atomicHandlerRuns = 0;
let atomicHandlerMode: "ok" | "failure" | "throw" | "rendezvous" = "ok";
let atomicInFlight = 0;
let atomicMaxInFlight = 0;
let atomicRendezvous: Promise<void> | undefined;
let releaseAtomicRendezvous: (() => void) | undefined;
const atomicHandler: WriteHandlerDef = {
  name: "atomic-slot",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: async () => {
    atomicHandlerRuns += 1;
    if (atomicHandlerMode === "throw") throw new Error("handler-boom");
    if (atomicHandlerMode === "failure") {
      return {
        isSuccess: false as const,
        error: {
          code: "slot_rejected",
          httpStatus: 422,
          message: "rejected",
          i18nKey: "errors.slot",
          details: {},
        },
      };
    }
    if (atomicHandlerMode === "rendezvous") {
      atomicInFlight += 1;
      atomicMaxInFlight = Math.max(atomicMaxInFlight, atomicInFlight);
      if (atomicInFlight >= 2) releaseAtomicRendezvous?.();
      // Resolves once a second call is inside the handler; the timeout only bounds the wait when calls are serialized.
      await Promise.race([atomicRendezvous, new Promise((r) => setTimeout(r, 3000))]);
      atomicInFlight -= 1;
    }
    return { isSuccess: true as const, data: {} };
  },
};
const wrappedAtomic = withCapEnforcement(atomicHandler, () => ({
  capName: ATOMIC_CAP_NAME,
  periodStartIso: TENANT_ONLY_PERIOD,
  limit: ATOMIC_CAP_LIMIT,
  profile: "hardSlot",
  notify: recordingNotifier,
}));
const ATOMIC_QN = "newsletter:write:atomic-slot";
const nestedAtomicCaller: WriteHandlerDef = {
  name: "atomic-slot-nested",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: (_event, ctx) => ctx.write(ATOMIC_QN, {}),
};
const ATOMIC_NESTED_QN = "newsletter:write:atomic-slot-nested";

const commitProbeEntity = createEntity({
  table: "cap_commit_probes",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const { table: commitProbeTable, executor: commitProbeExecutor } = createEntityExecutor(
  "commit-probe",
  commitProbeEntity,
);
// The handler succeeds; the deferred trigger created in beforeAll rejects the row only at COMMIT.
const commitFailingHandler: WriteHandlerDef = {
  name: "atomic-commit-fails",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: (event, ctx) =>
    commitProbeExecutor.create({ label: "commit-fails" }, event.user, ctx.db),
};
const COMMIT_FAIL_CAP_NAME = "atomic-commit-fail-cap";
const wrappedCommitFailing = withCapEnforcement(commitFailingHandler, () => ({
  capName: COMMIT_FAIL_CAP_NAME,
  periodStartIso: TENANT_ONLY_PERIOD,
  limit: ATOMIC_CAP_LIMIT,
  profile: "hardSlot",
  notify: recordingNotifier,
}));
const COMMIT_FAIL_QN = "newsletter:write:atomic-commit-fails";

const POOL_CAP_NAME = "atomic-pool-cap";
const poolSlotHandler: WriteHandlerDef = {
  name: "atomic-pool-slot",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { isSuccess: true as const, data: {} };
  },
};
const wrappedPoolSlot = withCapEnforcement(poolSlotHandler, () => ({
  capName: POOL_CAP_NAME,
  periodStartIso: TENANT_ONLY_PERIOD,
  limit: 1000,
  profile: "hardSlot",
  notify: recordingNotifier,
}));
const POOL_SLOT_QN = "newsletter:write:atomic-pool-slot";

const NEWSLETTER_TENANT_ONLY_QN = "newsletter:write:send-newsletter-tenant-only";
const BOOK_OUTSIDE_TX_QN = "newsletter:write:book-outside-tx-then-fail";

// =============================================================================
// Parallel-booking-race probes — return bookCapUsage's result
// directly so a lost optimistic-lock race surfaces as an HTTP error instead
// of being swallowed.
// =============================================================================

const PARALLEL_BOOKING_IN_TX_CAP_NAME = "parallel-booking-in-tx-cap";
const bookCapUsageInTxHandler: WriteHandlerDef = {
  name: "book-cap-usage-in-tx",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: (_event, ctx) =>
    bookCapUsage(ctx, {
      capName: PARALLEL_BOOKING_IN_TX_CAP_NAME,
      periodStartIso: TENANT_ONLY_PERIOD,
    }),
};

const PARALLEL_BOOKING_OUTSIDE_TX_CAP_NAME = "parallel-booking-outside-tx-cap";
const bookCapUsageOutsideTxHandler: WriteHandlerDef = {
  name: "book-cap-usage-outside-tx",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: (_event, ctx) =>
    bookCapUsage(ctx, {
      capName: PARALLEL_BOOKING_OUTSIDE_TX_CAP_NAME,
      periodStartIso: TENANT_ONLY_PERIOD,
      outsideTransaction: true,
    }),
};

const PARALLEL_SOFT_WARN_CAP_NAME = "parallel-soft-warn-cap";
const markCapSoftWarnedHandler: WriteHandlerDef = {
  name: "mark-cap-soft-warned",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: (_event, ctx) =>
    markCapSoftWarned(ctx, {
      capName: PARALLEL_SOFT_WARN_CAP_NAME,
      periodStartIso: TENANT_ONLY_PERIOD,
    }),
};

const BOOK_CAP_USAGE_IN_TX_QN = "newsletter:write:book-cap-usage-in-tx";
const MARK_CAP_SOFT_WARNED_QN = "newsletter:write:mark-cap-soft-warned";
const BOOK_CAP_USAGE_OUTSIDE_TX_QN = "newsletter:write:book-cap-usage-outside-tx";

const newsletterFeature = defineFeature("newsletter", (r) => {
  r.writeHandler(wrappedCalendar);
  r.writeHandler(wrappedRolling);
  r.writeHandler(wrappedCalendarTenantOnly);
  r.writeHandler(wrappedAtomic);
  r.writeHandler(nestedAtomicCaller);
  r.writeHandler(wrappedCommitFailing);
  r.writeHandler(wrappedPoolSlot);
  r.entity("commit-probe", commitProbeEntity);
  r.writeHandler(bookOutsideTxThenFailHandler);
  r.writeHandler(bookCapUsageInTxHandler);
  r.writeHandler(bookCapUsageOutsideTxHandler);
  r.writeHandler(markCapSoftWarnedHandler);
});

// =============================================================================
// Setup
// =============================================================================

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({ features: [capCounterFeature, newsletterFeature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, capCounterEntity);
  await unsafeCreateEntityTable(db, commitProbeEntity);
  await asRawClient(db).unsafe(`
    CREATE FUNCTION cap_commit_probe_reject_at_commit() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'rejected at commit';
    END;
    $$ LANGUAGE plpgsql`);
  await asRawClient(db).unsafe(`
    CREATE CONSTRAINT TRIGGER cap_commit_probe_commit_gate
    AFTER INSERT ON "${commitProbeTable.tableName}"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION cap_commit_probe_reject_at_commit()`);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(db, [capCounterTable, eventsTable]);
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

function tenantAdminOnlyFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin"],
  });
}

async function readCounter(user: ReturnType<typeof adminFor>, capName: string, period: string) {
  return (await stack.http.queryOk(
    CapCounterQueries.getCounter,
    { capName, periodStartIso: period },
    user,
  )) as Record<string, unknown> | null;
}

function resetState() {
  sendCallCount = 0;
  failNextSend = false;
  recordedNotifications.length = 0;
}

// =============================================================================
// Calendar-wrapper scenarios
// =============================================================================

describe("withCapEnforcement — calendar", () => {
  test("under-cap: handler läuft, counter inkrementiert um 1 pro success", async () => {
    resetState();
    const admin = adminFor(1201);

    await stack.http.writeOk(NEWSLETTER_QN, { to: "a@x.de" }, admin);
    await stack.http.writeOk(NEWSLETTER_QN, { to: "b@x.de" }, admin);
    await stack.http.writeOk(NEWSLETTER_QN, { to: "c@x.de" }, admin);

    expect(sendCallCount).toBe(3);
    const row = await readCounter(admin, "newsletter-cap", PERIOD);
    expect(row).not.toBeNull();
    expect(row!["value"]).toBe(3);
    expect(recordedNotifications).toHaveLength(0);
  });

  test("hard-hit: handler läuft NICHT, counter NICHT weiter inkrementiert", async () => {
    resetState();
    const admin = adminFor(1203);
    // limit=5, soft=1.1×5=5.5, hard=1.2×5=6. Da Counter int ist, springt
    // value(5)→6 direkt in den hard-Bereich (keine intermediate soft-zone
    // bei limit=5). Soft-hit-Verhalten ist im enforce-cap-Integration-Test
    // mit limit=1000 schon gepinnt; hier liegt der Fokus auf hard-block.
    for (let i = 0; i < 6; i++) {
      await stack.http.writeOk(NEWSLETTER_QN, { to: `${i}@x.de` }, admin);
    }
    expect(sendCallCount).toBe(6);
    const beforeBlocked = await readCounter(admin, "newsletter-cap", PERIOD);
    expect(beforeBlocked!["value"]).toBe(6);

    // 7. send: pre-call sieht value=6 ≥ hard=6 → CapExceededError (extends
    // KumikoError) → dispatcher mapped auto auf 429 + cap_exceeded.
    const error = await stack.http.writeErr(NEWSLETTER_QN, { to: "blocked@x.de" }, admin);
    expect(error.code).toBe("cap_exceeded");
    expect(error.httpStatus).toBe(429);

    // Drift-Pin: handler darf NICHT gelaufen sein (sendCallCount unverändert)
    expect(sendCallCount).toBe(6);
    // Drift-Pin: counter NICHT weiter inkrementiert (immer noch 6)
    const afterBlocked = await readCounter(admin, "newsletter-cap", PERIOD);
    expect(afterBlocked!["value"]).toBe(6);
  });

  test("failed handler: counter NICHT inkrementiert (cap-quota nicht verbrannt)", async () => {
    resetState();
    const admin = adminFor(1204);

    // Erster send: success, counter → 1
    await stack.http.writeOk(NEWSLETTER_QN, { to: "first@x.de" }, admin);
    expect(sendCallCount).toBe(1);

    // Zweiter send schlägt fehl im inner-handler (failNextSend=true).
    // Wrapper soll NICHT inkrementieren.
    failNextSend = true;
    await stack.http.writeErr(NEWSLETTER_QN, { to: "fail@x.de" }, admin);
    expect(sendCallCount).toBe(2);

    // Counter bleibt bei 1 — der gescheiterte send hat keine quota verbrannt.
    const row = await readCounter(admin, "newsletter-cap", PERIOD);
    expect(row!["value"]).toBe(1);
  });
});

// =============================================================================
// Rolling-wrapper scenarios — kürzer, weil Notification-Wiring + base-flow
// schon vom calendar-Test abgedeckt sind.
// =============================================================================

describe("withRollingCapEnforcement — rolling", () => {
  test("under-cap: handler läuft, increment-rolling-events accumulieren", async () => {
    resetState();
    const admin = adminFor(1301);

    await stack.http.writeOk(NEWSLETTER_ROLLING_QN, { to: "a@x.de" }, admin);
    await stack.http.writeOk(NEWSLETTER_ROLLING_QN, { to: "b@x.de" }, admin);
    expect(sendCallCount).toBe(2);
    // Read via enforceRollingCap — kein direct-getter, aber wir können
    // einen weiteren write absetzen und das Ergebnis prüfen ist
    // upstream. Wichtig: handler ist aufgerufen.
  });

  test("hard-hit: rolling-counter blockiert weitere sends", async () => {
    resetState();
    const admin = adminFor(1302);

    // limit=5, soft=5.5, hard=6. 6 sends bringen value=6 → 7. send blockiert.
    for (let i = 0; i < 6; i++) {
      await stack.http.writeOk(NEWSLETTER_ROLLING_QN, { to: `${i}@x.de` }, admin);
    }
    expect(sendCallCount).toBe(6);

    const error = await stack.http.writeErr(NEWSLETTER_ROLLING_QN, { to: "blocked@x.de" }, admin);
    expect(error.code).toBe("cap_exceeded");
    expect(error.httpStatus).toBe(429);
    expect(sendCallCount).toBe(6); // handler wurde NICHT erneut aufgerufen
  });

  test("failed handler: kein increment-rolling-event hinzugefügt (cap-quota nicht verbrannt)", async () => {
    // Symmetrisch zum calendar-Test "failed handler: counter NICHT
    // inkrementiert". Beweist dass der rolling-Wrapper denselben
    // Atomicity-Vertrag erfüllt: nur erfolgreiche handler verbrennen
    // quota.
    resetState();
    const admin = adminFor(1303);

    // 1. send: success → increment-rolling-event #1
    await stack.http.writeOk(NEWSLETTER_ROLLING_QN, { to: "first@x.de" }, admin);
    expect(sendCallCount).toBe(1);

    // 2. send: handler wirft → kein increment-rolling-event
    failNextSend = true;
    await stack.http.writeErr(NEWSLETTER_ROLLING_QN, { to: "fail@x.de" }, admin);
    expect(sendCallCount).toBe(2);

    // 3. send: success → increment-rolling-event #2 (Drift-Pin: counter
    // steht bei 2, NICHT bei 3 — der gescheiterte send #2 hat keine
    // quota verbrannt). Wir treiben den counter bis genau hard-1, das
    // funktioniert NUR wenn #2 nicht gezählt wurde.
    for (let i = 0; i < 4; i++) {
      await stack.http.writeOk(NEWSLETTER_ROLLING_QN, { to: `s-${i}@x.de` }, admin);
    }
    expect(sendCallCount).toBe(6);

    // 7. send (= hard@6): blockiert. counter steht bei 5 (1 + 4),
    // pre-call sieht 5 < hard@6 → handler läuft + increment, counter
    // steigt auf 6. Direkt danach blockiert der nächste send.
    // Wenn der gescheiterte send fälschlich gezählt hätte, wäre der
    // counter schon bei 6 und der jetzt-erlaubte send würde blockieren.
    await stack.http.writeOk(NEWSLETTER_ROLLING_QN, { to: "last-allowed@x.de" }, admin);
    expect(sendCallCount).toBe(7);

    const blocked = await stack.http.writeErr(NEWSLETTER_ROLLING_QN, { to: "blocked@x.de" }, admin);
    expect(blocked.code).toBe("cap_exceeded");
    expect(blocked.httpStatus).toBe(429);
    expect(sendCallCount).toBe(7); // wrapper hat den blockierten handler NICHT gerufen
  });
});

// =============================================================================
// TenantAdmin-only calendar callers (no SystemAdmin, no escapeHatch) — fw#2854
// =============================================================================

describe("withCapEnforcement — calendar, TenantAdmin-only callers", () => {
  test("calendar: TenantAdmin-only caller books usage, soft-warn flag gets set, hard cap blocks", async () => {
    const user = tenantAdminOnlyFor(2201);

    // limit=10, burstable(soft=1.1,hard=1.2) → soft=11, hard=12. 12 successful
    // calls cross the soft threshold on the 12th (pre-check sees value=11);
    // the 13th sees value=12 >= hard and blocks.
    for (let i = 0; i < 12; i++) {
      await stack.http.writeOk(NEWSLETTER_TENANT_ONLY_QN, { to: `${i}@x.de` }, user);
    }
    const row = await readCounter(user, "newsletter-cap-tenant-only", TENANT_ONLY_PERIOD);
    expect(row).not.toBeNull();
    expect(row!["value"]).toBe(12);
    expect(row!["lastSoftWarnedAt"]).not.toBeNull();

    const blocked = await stack.http.writeErr(
      NEWSLETTER_TENANT_ONLY_QN,
      { to: "blocked@x.de" },
      user,
    );
    expect(blocked.code).toBe("cap_exceeded");
    expect(blocked.httpStatus).toBe(429);
  });

  test("tenant B's counter is unaffected by tenant A's TenantAdmin-only bookings", async () => {
    const tenantA = tenantAdminOnlyFor(2301);
    const tenantB = tenantAdminOnlyFor(2302);

    for (let i = 0; i < 3; i++) {
      await stack.http.writeOk(NEWSLETTER_TENANT_ONLY_QN, { to: `${i}@x.de` }, tenantA);
    }

    const rowA = await readCounter(tenantA, "newsletter-cap-tenant-only", TENANT_ONLY_PERIOD);
    expect(rowA!["value"]).toBe(3);

    const rowB = await readCounter(tenantB, "newsletter-cap-tenant-only", TENANT_ONLY_PERIOD);
    expect(rowB).toBeNull();
  });

  test("bookCapUsage(..., outsideTransaction: true) survives the handler's own rollback", async () => {
    const user = tenantAdminOnlyFor(2401);

    const error = await stack.http.writeErr(BOOK_OUTSIDE_TX_QN, {}, user);
    expect(error.httpStatus).toBeGreaterThanOrEqual(400);

    const row = await readCounter(user, OUTSIDE_TX_CAP_NAME, TENANT_ONLY_PERIOD);
    expect(row).not.toBeNull();
    expect(row!["value"]).toBe(1);
  });

  test("readRollingCapUsage: tenant B reads 0 for the same capName after tenant A booked", async () => {
    const tenantA = adminFor(2501);
    const tenantB = adminFor(2502);

    await stack.http.writeOk(NEWSLETTER_ROLLING_QN, { to: "a@x.de" }, tenantA);

    const usageA = await readRollingCapUsage(
      createTenantDb(stack.db, tenantA.tenantId),
      tenantA.tenantId,
      { capName: "newsletter-rolling-cap", windowDays: 7 },
    );
    expect(usageA).toBe(1);

    const usageB = await readRollingCapUsage(
      createTenantDb(stack.db, tenantB.tenantId),
      tenantB.tenantId,
      { capName: "newsletter-rolling-cap", windowDays: 7 },
    );
    expect(usageB).toBe(0);
  });
});

// =============================================================================
// Parallel bookCapUsage calls for the same (tenant, cap, period)
// =============================================================================

const PARALLEL_BOOKINGS = 6;

describe("bookCapUsage — parallel bookings for the same period", () => {
  test("in-tx: N concurrent bookings all succeed and the counter sums to N, then 2N", async () => {
    const user = tenantAdminOnlyFor(2601);

    await Promise.all(
      Array.from({ length: PARALLEL_BOOKINGS }, () =>
        stack.http.writeOk(BOOK_CAP_USAGE_IN_TX_QN, {}, user),
      ),
    );
    const afterCreateRace = await readCounter(
      user,
      PARALLEL_BOOKING_IN_TX_CAP_NAME,
      TENANT_ONLY_PERIOD,
    );
    expect(afterCreateRace!["value"]).toBe(PARALLEL_BOOKINGS);

    await Promise.all(
      Array.from({ length: PARALLEL_BOOKINGS }, () =>
        stack.http.writeOk(BOOK_CAP_USAGE_IN_TX_QN, {}, user),
      ),
    );
    const afterUpdateRace = await readCounter(
      user,
      PARALLEL_BOOKING_IN_TX_CAP_NAME,
      TENANT_ONLY_PERIOD,
    );
    expect(afterUpdateRace!["value"]).toBe(PARALLEL_BOOKINGS * 2);
  });

  // N=6 stays below the default pool max (10): each outside-tx request holds
  // both a handler-tx connection and a dbOutsideTransaction connection.
  test("outside-tx: N concurrent bookings all succeed and the counter sums to N, then 2N", async () => {
    const user = tenantAdminOnlyFor(2602);

    await Promise.all(
      Array.from({ length: PARALLEL_BOOKINGS }, () =>
        stack.http.writeOk(BOOK_CAP_USAGE_OUTSIDE_TX_QN, {}, user),
      ),
    );
    const afterCreateRace = await readCounter(
      user,
      PARALLEL_BOOKING_OUTSIDE_TX_CAP_NAME,
      TENANT_ONLY_PERIOD,
    );
    expect(afterCreateRace!["value"]).toBe(PARALLEL_BOOKINGS);

    await Promise.all(
      Array.from({ length: PARALLEL_BOOKINGS }, () =>
        stack.http.writeOk(BOOK_CAP_USAGE_OUTSIDE_TX_QN, {}, user),
      ),
    );
    const afterUpdateRace = await readCounter(
      user,
      PARALLEL_BOOKING_OUTSIDE_TX_CAP_NAME,
      TENANT_ONLY_PERIOD,
    );
    expect(afterUpdateRace!["value"]).toBe(PARALLEL_BOOKINGS * 2);
  });
});

// postgres.js keeps its pool size on the client's `options`; the DbConnection type does not expose it.
function connectionPoolSize(connection: DbConnection): number {
  const options: unknown = Reflect.get(connection, "options");
  const max = typeof options === "object" && options !== null ? Reflect.get(options, "max") : null;
  if (typeof max !== "number") throw new Error("connection pool size is not readable");
  return max;
}

function resetAtomicState(mode: typeof atomicHandlerMode) {
  atomicHandlerRuns = 0;
  atomicHandlerMode = mode;
  atomicInFlight = 0;
  atomicMaxInFlight = 0;
  atomicRendezvous = new Promise<void>((resolve) => {
    releaseAtomicRendezvous = resolve;
  });
}

describe("withCapEnforcement - atomic reservation", () => {
  test("N parallel calls at limit L run the handler and book exactly L (also racing on the first create)", async () => {
    resetAtomicState("ok");
    const user = tenantAdminOnlyFor(2701);

    const responses = await Promise.all(
      Array.from({ length: PARALLEL_BOOKINGS }, () => stack.http.write(ATOMIC_QN, {}, user)),
    );

    expect(responses.filter((r) => r.status === 200)).toHaveLength(ATOMIC_CAP_LIMIT);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(
      PARALLEL_BOOKINGS - ATOMIC_CAP_LIMIT,
    );
    expect(atomicHandlerRuns).toBe(ATOMIC_CAP_LIMIT);
    const row = await readCounter(user, ATOMIC_CAP_NAME, TENANT_ONLY_PERIOD);
    expect(row!["value"]).toBe(ATOMIC_CAP_LIMIT);
  });

  test("two calls on the same counter can be inside the handler at the same time", async () => {
    resetAtomicState("rendezvous");
    const user = tenantAdminOnlyFor(2703);

    const responses = await Promise.all([
      stack.http.write(ATOMIC_QN, {}, user),
      stack.http.write(ATOMIC_QN, {}, user),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(atomicMaxInFlight).toBe(2);
  });

  test("a capped handler reached through a nested ctx.write is rejected instead of running unreserved", async () => {
    resetAtomicState("ok");
    const user = tenantAdminOnlyFor(2705);

    const response = await stack.http.write(ATOMIC_NESTED_QN, {}, user);

    expect(response.status).toBe(500);
    expect(atomicHandlerRuns).toBe(0);
    expect(await readCounter(user, ATOMIC_CAP_NAME, TENANT_ONLY_PERIOD)).toBeNull();
  });

  test("a failed COMMIT after a successful handler gives the reservation back", async () => {
    const user = tenantAdminOnlyFor(2706);

    const response = await stack.http.write(COMMIT_FAIL_QN, {}, user);

    expect(response.status).toBeGreaterThanOrEqual(500);
    const row = await readCounter(user, COMMIT_FAIL_CAP_NAME, TENANT_ONLY_PERIOD);
    expect(row!["value"]).toBe(0);
  });

  test("capped requests beyond the pool size all complete (no connection held across the handler)", async () => {
    const poolSize = connectionPoolSize(db);
    const user = tenantAdminOnlyFor(2707);

    const responses = await Promise.all(
      Array.from({ length: poolSize + 2 }, () => stack.http.write(POOL_SLOT_QN, {}, user)),
    );

    expect(responses.map((r) => r.status)).toEqual(Array(poolSize + 2).fill(200));
    const row = await readCounter(user, POOL_CAP_NAME, TENANT_ONLY_PERIOD);
    expect(row!["value"]).toBe(poolSize + 2);
  });

  test("a handler that throws gives the reservation back", async () => {
    resetAtomicState("throw");
    const user = tenantAdminOnlyFor(2704);

    await stack.http.writeErr(ATOMIC_QN, {}, user);

    expect(atomicHandlerRuns).toBe(1);
    const row = await readCounter(user, ATOMIC_CAP_NAME, TENANT_ONLY_PERIOD);
    expect(row!["value"]).toBe(0);
  });

  test("a handler that returns a failure result gives the reservation back", async () => {
    resetAtomicState("failure");
    const user = tenantAdminOnlyFor(2702);

    await stack.http.writeErr(ATOMIC_QN, {}, user);

    expect(atomicHandlerRuns).toBe(1);
    const row = await readCounter(user, ATOMIC_CAP_NAME, TENANT_ONLY_PERIOD);
    expect(row!["value"]).toBe(0);
    atomicHandlerMode = "ok";
    for (let i = 0; i < ATOMIC_CAP_LIMIT; i++) {
      await stack.http.writeOk(ATOMIC_QN, {}, user);
    }
  });
});

describe("markCapSoftWarned - parallel marks on an existing counter", () => {
  test("N concurrent marks all succeed and lastSoftWarnedAt is set", async () => {
    const user = tenantAdminOnlyFor(2603);
    await stack.http.writeOk(
      CapCounterHandlers.increment,
      { capName: PARALLEL_SOFT_WARN_CAP_NAME, periodStartIso: TENANT_ONLY_PERIOD },
      adminFor(2603),
    );
    expect(
      (await readCounter(user, PARALLEL_SOFT_WARN_CAP_NAME, TENANT_ONLY_PERIOD))?.[
        "lastSoftWarnedAt"
      ],
    ).toBeNull();

    await Promise.all(
      Array.from({ length: PARALLEL_BOOKINGS }, () =>
        stack.http.writeOk(MARK_CAP_SOFT_WARNED_QN, {}, user),
      ),
    );

    const counter = await readCounter(user, PARALLEL_SOFT_WARN_CAP_NAME, TENANT_ONLY_PERIOD);
    expect(counter?.["lastSoftWarnedAt"]).not.toBeNull();

    // Losers of the version race must see the flag on retry and not append duplicates:
    // one create (increment) + exactly one update (the winning mark).
    const events = await selectMany(stack.db, eventsTable, {
      aggregateId: capCounterAggregateId(
        user.tenantId,
        PARALLEL_SOFT_WARN_CAP_NAME,
        TENANT_ONLY_PERIOD,
      ),
    });
    expect(events).toHaveLength(2);
  });
});
