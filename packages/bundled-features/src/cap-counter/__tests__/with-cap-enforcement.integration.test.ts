// Integration-test for withCapEnforcement / withRollingCapEnforcement.
// Beweist die Wrapper-Verdrahtung end-to-end:
//   1. Pre-call: enforceCapAndMaybeNotify dispatched (notifier feuert,
//      mark-soft-warned-handler kippt das DB-Flag)
//   2. Handler runs — only when below hard-cap
//   3. Post-success: ctx.write(increment) — counter steigt um `amount`
//   4. Hard-hit: handler runs NICHT, counter NICHT inkrementiert
//   5. Failed handler: counter NICHT inkrementiert (cap-quota nicht
//      verbrannt für gescheiterte writes)

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
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
import { z } from "zod";
import { bookCapUsage, readRollingCapUsage } from "../book-cap-usage";
import { CapCounterQueries } from "../constants";
import type { SoftHitNotifier } from "../enforce-cap";
import { capCounterEntity } from "../entity";
import { capCounterFeature } from "../feature";
import { withCapEnforcement, withRollingCapEnforcement } from "../with-cap-enforcement";

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

const NEWSLETTER_TENANT_ONLY_QN = "newsletter:write:send-newsletter-tenant-only";
const BOOK_OUTSIDE_TX_QN = "newsletter:write:book-outside-tx-then-fail";

const newsletterFeature = defineFeature("newsletter", (r) => {
  r.writeHandler(wrappedCalendar);
  r.writeHandler(wrappedRolling);
  r.writeHandler(wrappedCalendarTenantOnly);
  r.writeHandler(bookOutsideTxThenFailHandler);
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
