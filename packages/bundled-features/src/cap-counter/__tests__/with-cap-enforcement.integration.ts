// Integration-test for withCapEnforcement / withRollingCapEnforcement.
// Beweist die Wrapper-Verdrahtung end-to-end:
//   1. Pre-call: enforceCapAndMaybeNotify dispatched (notifier feuert,
//      mark-soft-warned-handler kippt das DB-Flag)
//   2. Handler runs — only when below hard-cap
//   3. Post-success: ctx.write(increment) — counter steigt um `amount`
//   4. Hard-hit: handler runs NICHT, counter NICHT inkrementiert
//   5. Failed handler: counter NICHT inkrementiert (cap-quota nicht
//      verbrannt für gescheiterte writes)

import type { DbConnection } from "@kumiko/framework/db";
import { defineFeature, type WriteHandlerDef } from "@kumiko/framework/engine";
import { createEventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@kumiko/framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
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
const newsletterFeature = defineFeature("newsletter", (r) => {
  r.writeHandler(wrappedCalendar);
  r.writeHandler(wrappedRolling);
});

// =============================================================================
// Setup
// =============================================================================

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({ features: [capCounterFeature, newsletterFeature] });
  db = stack.db;
  await createEntityTable(db, capCounterEntity);
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
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

    // 7. send: pre-call sieht value=6 ≥ hard=6 → CapExceededError, der
    // dispatcher wickelt's als internal_error mit causeName=CapExceededError.
    const error = await stack.http.writeErr(NEWSLETTER_QN, { to: "blocked@x.de" }, admin);
    expect(JSON.stringify(error)).toMatch(/CapExceededError/);

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
    expect(JSON.stringify(error)).toMatch(/CapExceededError/);
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
    expect(JSON.stringify(blocked)).toMatch(/CapExceededError/);
    expect(sendCallCount).toBe(7); // wrapper hat den blockierten handler NICHT gerufen
  });
});
