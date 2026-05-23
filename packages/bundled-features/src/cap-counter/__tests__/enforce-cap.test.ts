// Pure unit tests for the enforce-cap helpers. Mocks ctx.db's
// select-chains via tiny in-memory stubs so we hit every branch
// without spinning up the test-stack — the real event-store +
// dispatcher integration is exercised in cap-counter.integration.ts.

import { describe, expect, test, vi } from "vitest";

// Temporal: rely on the global ambient declaration from temporal-spec.
// The framework polyfill is loaded by setupTestStack, but pure unit
// tests (no stack) need a manual polyfill — vitest.setup.ts does that.
import {
  CAP_TOLERANCES,
  CapExceededError,
  currentCalendarMonthStartIso,
  enforceCap,
  enforceCapAndMaybeNotify,
  enforceRollingCap,
  enforceRollingCapAndMaybeNotify,
} from "../enforce-cap";

// Test-mock: ctx.db unterstützt sowohl bun-db's .unsafe() (selectMany ruft das)
// als auch drizzle's .select().from().where() chain (rolling-path nutzt das
// direkt). Beide pfade returnen denselben rows-set unabhängig von filtern.

function makeMockDb(rows: unknown[]) {
  return {
    unsafe: async () => rows,
    begin: async <T,>(fn: (tx: unknown) => Promise<T>) =>
      fn({ unsafe: async () => rows, begin: async () => undefined }),
    select: () => ({
      from: () => ({
        where: Object.assign(async () => rows, {
          // calendar path also chains .limit(1) after .where()
          limit: async () => rows,
        }),
      }),
    }),
  };
}

function stubCalendarCtx(rows: { value: number; lastSoftWarnedAt: unknown }[]) {
  const ctx = {
    db: makeMockDb(rows),
    user: { tenantId: "tenant-test" },
  };
  return ctx as unknown as Parameters<typeof enforceCap>[0];
}

function stubRollingCtx(eventPayloads: { amount: number }[]) {
  const rows = eventPayloads.map((p) => ({ payload: p }));
  const ctx = {
    db: makeMockDb(rows),
    user: { tenantId: "tenant-test" },
  };
  return ctx as unknown as Parameters<typeof enforceRollingCap>[0];
}

const PERIOD = "2026-05-01T00:00:00Z";

// =============================================================================
// enforceCap — calendar-period
// =============================================================================

describe("enforceCap — burstable profile (mails / tokens)", () => {
  const opts = {
    capName: "mails-per-month",
    periodStartIso: PERIOD,
    limit: 1000,
    profile: "burstable" as const,
  };

  test("value below soft-threshold → ok", async () => {
    const ctx = stubCalendarCtx([{ value: 500, lastSoftWarnedAt: null }]);
    const result = await enforceCap(ctx, opts);
    expect(result.state).toBe("ok");
    if (result.state === "ok") {
      expect(result.value).toBe(500);
    }
  });

  test("no row exists yet → value=0, ok", async () => {
    const ctx = stubCalendarCtx([]);
    const result = await enforceCap(ctx, opts);
    expect(result.state).toBe("ok");
    if (result.state === "ok") {
      expect(result.value).toBe(0);
    }
  });

  test("value at soft-threshold (1100, soft=1.1) → soft-hit, crossed=true on first warn", async () => {
    const ctx = stubCalendarCtx([{ value: 1100, lastSoftWarnedAt: null }]);
    const result = await enforceCap(ctx, opts);
    expect(result.state).toBe("soft-hit");
    if (result.state === "soft-hit") {
      expect(result.value).toBe(1100);
      expect(result.crossed).toBe(true);
    }
  });

  test("value past soft, already warned → soft-hit, crossed=false (no re-notification)", async () => {
    const ctx = stubCalendarCtx([{ value: 1150, lastSoftWarnedAt: "2026-05-15T12:00:00Z" }]);
    const result = await enforceCap(ctx, opts);
    expect(result.state).toBe("soft-hit");
    if (result.state === "soft-hit") {
      expect(result.crossed).toBe(false);
    }
  });

  test("value at hard-threshold (1200, hard=1.2) → throws CapExceededError", async () => {
    const ctx = stubCalendarCtx([{ value: 1200, lastSoftWarnedAt: null }]);
    await expect(enforceCap(ctx, opts)).rejects.toThrow(CapExceededError);
  });

  test("CapExceededError carries cap-name + limit + currentValue", async () => {
    const ctx = stubCalendarCtx([{ value: 1500, lastSoftWarnedAt: null }]);
    try {
      await enforceCap(ctx, opts);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CapExceededError);
      const err = e as CapExceededError;
      expect(err.code).toBe("cap_exceeded");
      expect(err.capName).toBe("mails-per-month");
      expect(err.limit).toBe(1000);
      expect(err.currentValue).toBe(1500);
    }
  });
});

describe("enforceCap — storage profile (DB / files)", () => {
  test("storage profile is stricter — soft@100% hard@105%", async () => {
    expect(CAP_TOLERANCES.storage.soft).toBe(1.0);
    expect(CAP_TOLERANCES.storage.hard).toBe(1.05);
  });

  test("at exactly limit (storage soft=1.0) → soft-hit", async () => {
    const ctx = stubCalendarCtx([{ value: 10240, lastSoftWarnedAt: null }]);
    const result = await enforceCap(ctx, {
      capName: "db-storage-mb",
      periodStartIso: PERIOD,
      limit: 10240,
      profile: "storage",
    });
    expect(result.state).toBe("soft-hit");
  });

  test("at 1.05× limit (storage hard) → throws", async () => {
    const ctx = stubCalendarCtx([{ value: 10752, lastSoftWarnedAt: null }]);
    await expect(
      enforceCap(ctx, {
        capName: "db-storage-mb",
        periodStartIso: PERIOD,
        limit: 10240,
        profile: "storage",
      }),
    ).rejects.toThrow(CapExceededError);
  });
});

describe("enforceCap — hardSlot profile (apps-count)", () => {
  test("hardSlot has zero buffer — hard@100%", async () => {
    expect(CAP_TOLERANCES.hardSlot.hard).toBe(1.0);
  });

  test("at exactly limit → throws (hardSlot is hard)", async () => {
    const ctx = stubCalendarCtx([{ value: 5, lastSoftWarnedAt: null }]);
    await expect(
      enforceCap(ctx, {
        capName: "apps-count",
        periodStartIso: PERIOD,
        limit: 5,
        profile: "hardSlot",
      }),
    ).rejects.toThrow(CapExceededError);
  });
});

describe("enforceCap — egress profile", () => {
  test("egress has the largest hard-buffer (130%) — bursty traffic legitimate", async () => {
    expect(CAP_TOLERANCES.egress.hard).toBe(1.3);
  });
});

// =============================================================================
// enforceRollingCap — Sprint 4: window-based read über Increment-Events
// =============================================================================

describe("enforceRollingCap — burstable profile (KI-tokens-7d)", () => {
  // limit=10000 chosen weil 10000 × 1.1 = 11000 und × 1.2 = 12000 als
  // exact integer floating-point bleiben (50000 × 1.1 wäre 55000.00000000001).
  const opts = {
    capName: "ai-tokens-7d",
    windowDays: 7,
    limit: 10000,
    profile: "burstable" as const,
  };

  test("no events in window → value=0, ok", async () => {
    const ctx = stubRollingCtx([]);
    const result = await enforceRollingCap(ctx, opts);
    expect(result.state).toBe("ok");
    if (result.state === "ok") {
      expect(result.value).toBe(0);
    }
  });

  test("sums amounts across multiple events", async () => {
    const ctx = stubRollingCtx([{ amount: 1000 }, { amount: 2500 }, { amount: 500 }]);
    const result = await enforceRollingCap(ctx, opts);
    expect(result.state).toBe("ok");
    if (result.state === "ok") {
      expect(result.value).toBe(4000);
    }
  });

  test("sum at soft-threshold (11000, soft=1.1×10000) → soft-hit, crossed=false", async () => {
    const ctx = stubRollingCtx([{ amount: 6000 }, { amount: 5000 }]);
    const result = await enforceRollingCap(ctx, opts);
    expect(result.state).toBe("soft-hit");
    if (result.state === "soft-hit") {
      expect(result.value).toBe(11000);
      // Rolling-counter trackt kein lastSoftWarnedAt — crossed ist immer false.
      expect(result.crossed).toBe(false);
    }
  });

  test("sum at hard-threshold (12000, hard=1.2×10000) → throws CapExceededError", async () => {
    const ctx = stubRollingCtx([{ amount: 6000 }, { amount: 6000 }]);
    await expect(enforceRollingCap(ctx, opts)).rejects.toThrow(CapExceededError);
  });

  test("ignores malformed payloads (no `amount` field) — defensive against schema-drift", async () => {
    // Sums only the well-formed events. If a future event-shape lands
    // with a different field name, we don't blow up — just under-count.
    const ctx = stubRollingCtx([
      { amount: 1000 },
      // @ts-expect-error — testing defensive read
      { other: 9999 },
      { amount: 2000 },
    ]);
    const result = await enforceRollingCap(ctx, opts);
    expect(result.state).toBe("ok");
    if (result.state === "ok") {
      expect(result.value).toBe(3000);
    }
  });
});

describe("enforceRollingCap — input validation", () => {
  test("missing ctx.db → throws clear error", async () => {
    const ctx = { user: { tenantId: "t" } } as unknown as Parameters<typeof enforceRollingCap>[0];
    await expect(
      enforceRollingCap(ctx, {
        capName: "x",
        windowDays: 7,
        limit: 1,
        profile: "burstable",
      }),
    ).rejects.toThrow(/ctx\.db missing/);
  });

  test("missing ctx.user.tenantId → throws clear error", async () => {
    const ctx = stubRollingCtx([]);
    delete (ctx as { user?: unknown }).user;
    await expect(
      enforceRollingCap(ctx, {
        capName: "x",
        windowDays: 7,
        limit: 1,
        profile: "burstable",
      }),
    ).rejects.toThrow(/tenantId missing/);
  });
});

// =============================================================================
// enforceCapAndMaybeNotify — Calendar + Notification-Wiring
// =============================================================================

describe("enforceCapAndMaybeNotify — calendar", () => {
  const baseOpts = {
    capName: "mails-per-month",
    periodStartIso: PERIOD,
    limit: 1000,
    profile: "burstable" as const,
  };

  test("ok → notifier NICHT aufgerufen", async () => {
    const ctx = stubCalendarCtx([{ value: 100, lastSoftWarnedAt: null }]);
    const notify = vi.fn();
    const result = await enforceCapAndMaybeNotify(ctx, { ...baseOpts, notify });
    expect(result.state).toBe("ok");
    expect(notify).not.toHaveBeenCalled();
  });

  test("soft-hit, crossed=true → notifier mit info-payload + ctx.write markSoftWarned", async () => {
    const ctx = stubCalendarCtx([{ value: 1100, lastSoftWarnedAt: null }]);
    const write = vi.fn(async () => ({ isSuccess: true, data: {} }));
    (ctx as unknown as { write: typeof write }).write = write;
    const notify = vi.fn();

    const result = await enforceCapAndMaybeNotify(ctx, { ...baseOpts, notify });
    expect(result.state).toBe("soft-hit");
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      capName: "mails-per-month",
      value: 1100,
      limit: 1000,
      tenantId: "tenant-test",
    });
    expect(write).toHaveBeenCalledExactlyOnceWith("cap-counter:write:mark-soft-warned", {
      capName: "mails-per-month",
      periodStartIso: PERIOD,
    });
  });

  test("soft-hit, crossed=false (already warned) → notifier NICHT erneut aufgerufen", async () => {
    const ctx = stubCalendarCtx([{ value: 1150, lastSoftWarnedAt: "2026-05-15T12:00:00Z" }]);
    const notify = vi.fn();
    const result = await enforceCapAndMaybeNotify(ctx, { ...baseOpts, notify });
    expect(result.state).toBe("soft-hit");
    expect(notify).not.toHaveBeenCalled();
  });

  test("hard-hit → throws CapExceededError BEVOR notifier feuert", async () => {
    const ctx = stubCalendarCtx([{ value: 1500, lastSoftWarnedAt: null }]);
    const notify = vi.fn();
    await expect(enforceCapAndMaybeNotify(ctx, { ...baseOpts, notify })).rejects.toThrow(
      CapExceededError,
    );
    expect(notify).not.toHaveBeenCalled();
  });
});

// =============================================================================
// enforceRollingCapAndMaybeNotify — Rolling + Notification (no dedup)
// =============================================================================

describe("enforceRollingCapAndMaybeNotify — rolling", () => {
  const baseOpts = {
    capName: "ai-tokens-7d",
    windowDays: 7,
    limit: 10000,
    profile: "burstable" as const,
  };

  test("ok → notifier NICHT aufgerufen", async () => {
    const ctx = stubRollingCtx([{ amount: 100 }]);
    const notify = vi.fn();
    const result = await enforceRollingCapAndMaybeNotify(ctx, { ...baseOpts, notify });
    expect(result.state).toBe("ok");
    expect(notify).not.toHaveBeenCalled();
  });

  test("soft-hit → notifier feuert (ohne dedup, Caller-Verantwortung)", async () => {
    const ctx = stubRollingCtx([{ amount: 6000 }, { amount: 5000 }]);
    const notify = vi.fn();
    const result = await enforceRollingCapAndMaybeNotify(ctx, { ...baseOpts, notify });
    expect(result.state).toBe("soft-hit");
    expect(notify).toHaveBeenCalledExactlyOnceWith({
      capName: "ai-tokens-7d",
      value: 11000,
      limit: 10000,
      tenantId: "tenant-test",
    });
  });

  test("zwei aufeinanderfolgende soft-hit-Calls → notifier 2× (kein Dedup)", async () => {
    // Drift-Pin: rolling-counter trackt KEIN lastSoftWarnedAt; Caller
    // muss selbst dedup'en (Cache-Eintrag, Hourly-Cron etc.). Wenn
    // ein Refactor heimlich Dedup einbaut ohne projection-row, fällt
    // das hier auf.
    const ctx = stubRollingCtx([{ amount: 11000 }]);
    const notify = vi.fn();
    await enforceRollingCapAndMaybeNotify(ctx, { ...baseOpts, notify });
    await enforceRollingCapAndMaybeNotify(ctx, { ...baseOpts, notify });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// Period-Helpers
// =============================================================================

describe("currentCalendarMonthStartIso", () => {
  test("returns 1st of month at 00:00 UTC, ISO format", () => {
    const midMay = Temporal.Instant.from("2026-05-15T14:32:11Z");
    const result = currentCalendarMonthStartIso(midMay);
    expect(result).toBe("2026-05-01T00:00:00Z");
  });
});

// =============================================================================
// Aggregate-ID drift-pins — Namespace-Wechsel würde tenant-stored
// Counter-History komplett re-keyen. Pinning der UUIDs.
// =============================================================================

describe("aggregate-id namespaces — drift-pin", () => {
  test("calendar capCounterAggregateId stable für (tenant, capName, period)", async () => {
    const { capCounterAggregateId } = await import("../aggregate-id");
    expect(capCounterAggregateId("tenant-1", "cap-x", "2026-05-01T00:00:00Z")).toBe(
      "2e74a706-7cc1-51ca-a1a7-89e5c5bccb7e",
    );
  });

  test("rolling rollingCapAggregateId stable für (tenant, capName)", async () => {
    const { rollingCapAggregateId } = await import("../aggregate-id");
    // Pinne den exakten UUID-output. Wenn jemand den Namespace-uuid in
    // aggregate-id.ts ändert, kollabiert die ganze rolling-counter-
    // history des Tenants — Test fängt's vor dem Deploy.
    expect(rollingCapAggregateId("tenant-1", "ai-tokens-7d")).toBe(
      "7d3dc5df-561f-555f-96d7-e9542d0de679",
    );
  });

  test("calendar und rolling produzieren UNTERSCHIEDLICHE UUIDs für gleiches Tupel", async () => {
    const { capCounterAggregateId, rollingCapAggregateId } = await import("../aggregate-id");
    // Selbst wenn jemand "1970-01-01..." als periodStart in den
    // calendar-Pfad reinpasst, soll die UUID NICHT mit dem rolling-
    // aggregate kollidieren — sonst würden sich die beiden Streams
    // vermischen und Counter wären falsch.
    const calendarId = capCounterAggregateId("tenant-1", "ai-tokens-7d", "1970-01-01T00:00:00Z");
    const rollingId = rollingCapAggregateId("tenant-1", "ai-tokens-7d");
    expect(calendarId).not.toBe(rollingId);
  });
});
