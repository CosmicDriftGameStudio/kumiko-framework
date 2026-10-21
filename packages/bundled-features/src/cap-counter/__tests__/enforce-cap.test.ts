// Pure unit tests for the enforce-cap helpers. Mocks ctx.db's
// select-chains via tiny in-memory stubs so we hit every branch
// without spinning up the test-stack — the real event-store +
// dispatcher integration is exercised in cap-counter.integration.ts.

import { describe, expect, mock, test } from "bun:test";
// Temporal: rely on the global ambient declaration from temporal-spec.
// The framework polyfill is loaded by setupTestStack, but pure unit
// tests (no stack) need a manual polyfill — vitest.setup.ts does that.
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { ROLLING_INCREMENTED_EVENT_QN } from "../constants.ts";
import {
  assertBelowHardCap,
  CAP_TOLERANCES,
  CapExceededError,
  calendarMonthPeriodEndIso,
  currentCalendarMonthStartIso,
  enforceCap,
  enforceCapAndMaybeNotify,
  enforceRollingCap,
  enforceRollingCapAndMaybeNotify,
} from "../enforce-cap.ts";

// Test-mock: ctx.db exposes TenantDb-style selectMany (production path)
// plus legacy drizzle .select().from().where() chain stubs.

function makeMockDb(rows: unknown[]) {
  // Honors the event `type` filter (rolling usage reads incremented and released events
  // separately); every other filter is ignored, as before.
  const selectMany = async (
    _table: unknown,
    where?: { type?: string },
    options?: { limit?: number },
  ) => {
    const matching =
      where?.type === undefined
        ? rows
        : rows.filter((row) => (row as { type?: string }).type === where.type);
    return options?.limit !== undefined ? matching.slice(0, options.limit) : matching;
  };
  return {
    unsafe: async () => rows,
    selectMany,
    begin: async <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({ unsafe: async () => rows, selectMany, begin: async () => undefined }),
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
  const rows = eventPayloads.map((p) => ({ payload: p, type: ROLLING_INCREMENTED_EVENT_QN }));
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

  test("amount checks the last of the booked units: 1190 + 10 units passes, + 11 throws", async () => {
    const ctx = stubCalendarCtx([{ value: 1190, lastSoftWarnedAt: null }]);
    const passing = await enforceCap(ctx, { ...opts, amount: 10 });
    expect(passing).toEqual({ state: "soft-hit", value: 1199, crossed: true });
    await expect(enforceCap(ctx, { ...opts, amount: 11 })).rejects.toThrow(CapExceededError);
  });

  test.each([0, -1, 1.5])("amount %p is rejected instead of bypassing the cap", async (amount) => {
    const ctx = stubCalendarCtx([{ value: 1200, lastSoftWarnedAt: null }]);
    await expect(enforceCap(ctx, { ...opts, amount })).rejects.toThrow(/positive integer/);
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
// enforceRollingCap — window-based reads over increment events
// =============================================================================

describe("enforceRollingCap — burstable profile (KI-tokens-7d)", () => {
  // `limit=10000` keeps 10000 × 1.1 = 11000 and × 1.2 = 12000 as
  // exact integers in floating-point arithmetic (50000 × 1.1 would be
  // 55000.00000000001).
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
      // The rolling counter does not track lastSoftWarnedAt, so crossed is always false.
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
    const notify = mock();
    const result = await enforceCapAndMaybeNotify(ctx, { ...baseOpts, notify });
    expect(result.state).toBe("ok");
    expect(notify).not.toHaveBeenCalled();
  });

  // soft-hit crossed=true (notify payload + DB flag flip) needs the real
  // event-store executor, so it lives in cap-counter.integration.test.ts
  // scenario 6 instead of a mock-ctx test here.

  test("soft-hit, crossed=false (already warned) → notifier NICHT erneut aufgerufen", async () => {
    const ctx = stubCalendarCtx([{ value: 1150, lastSoftWarnedAt: "2026-05-15T12:00:00Z" }]);
    const notify = mock();
    const result = await enforceCapAndMaybeNotify(ctx, { ...baseOpts, notify });
    expect(result.state).toBe("soft-hit");
    expect(notify).not.toHaveBeenCalled();
  });

  test("hard-hit → throws CapExceededError BEVOR notifier feuert", async () => {
    const ctx = stubCalendarCtx([{ value: 1500, lastSoftWarnedAt: null }]);
    const notify = mock();
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
    const notify = mock();
    const result = await enforceRollingCapAndMaybeNotify(ctx, { ...baseOpts, notify });
    expect(result.state).toBe("ok");
    expect(notify).not.toHaveBeenCalled();
  });

  test("soft-hit → notifier feuert (ohne dedup, Caller-Verantwortung)", async () => {
    const ctx = stubRollingCtx([{ amount: 6000 }, { amount: 5000 }]);
    const notify = mock();
    const result = await enforceRollingCapAndMaybeNotify(ctx, { ...baseOpts, notify });
    expect(result.state).toBe("soft-hit");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      capName: "ai-tokens-7d",
      value: 11000,
      limit: 10000,
      tenantId: "tenant-test",
    });
  });

  test("zwei aufeinanderfolgende soft-hit-Calls → notifier 2× (kein Dedup)", async () => {
    // The rolling counter does not track lastSoftWarnedAt; the caller must
    // deduplicate notifications itself (for example, with a cache entry or
    // hourly cron). This detects a refactor that adds deduplication without
    // a projection row.
    const ctx = stubRollingCtx([{ amount: 11000 }]);
    const notify = mock();
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
// Aggregate-ID drift pins — changing the namespace would completely re-key
// tenant-stored counter history. These tests pin the UUIDs.
// =============================================================================

describe("aggregate-id namespaces — drift-pin", () => {
  test("calendar capCounterAggregateId stable für (tenant, capName, period)", async () => {
    const { capCounterAggregateId } = await import("../aggregate-id.ts");
    expect(capCounterAggregateId("tenant-1", "cap-x", "2026-05-01T00:00:00Z")).toBe(
      "2e74a706-7cc1-51ca-a1a7-89e5c5bccb7e",
    );
  });

  test("rolling rollingCapAggregateId stable für (tenant, capName)", async () => {
    const { rollingCapAggregateId } = await import("../aggregate-id.ts");
    // Pin the exact UUID output. Changing the namespace UUID in
    // aggregate-id.ts would invalidate the tenant's entire rolling-counter
    // history, so this test catches the change before deployment.
    expect(rollingCapAggregateId("tenant-1", "ai-tokens-7d")).toBe(
      "7d3dc5df-561f-555f-96d7-e9542d0de679",
    );
  });

  test("calendar und rolling produzieren UNTERSCHIEDLICHE UUIDs für gleiches Tupel", async () => {
    const { capCounterAggregateId, rollingCapAggregateId } = await import("../aggregate-id.ts");
    // Even if someone passes "1970-01-01..." as periodStart to the calendar
    // path, its UUID must not collide with the rolling aggregate; otherwise
    // the two streams would merge and counters would be incorrect.
    const calendarId = capCounterAggregateId("tenant-1", "ai-tokens-7d", "1970-01-01T00:00:00Z");
    const rollingId = rollingCapAggregateId("tenant-1", "ai-tokens-7d");
    expect(calendarId).not.toBe(rollingId);
  });
});

describe("calendarMonthPeriodEndIso", () => {
  test("adds one calendar month in UTC", () => {
    expect(calendarMonthPeriodEndIso("2026-07-01T00:00:00Z")).toBe("2026-08-01T00:00:00Z");
  });

  test("rolls December over into January of the next year", () => {
    expect(calendarMonthPeriodEndIso("2026-12-01T00:00:00Z")).toBe("2027-01-01T00:00:00Z");
  });
});

describe("CapExceededError reset info", () => {
  const now = Temporal.Instant.from("2026-07-10T00:00:00Z");
  const tolerance = CAP_TOLERANCES.hardSlot;

  test("resetAt and retryAfterSeconds are derived from the period end", () => {
    const err = new CapExceededError("c", 1, 1, tolerance, {
      resetAt: "2026-08-01T00:00:00Z",
      now,
    });
    expect(err.resetAt).toBe("2026-08-01T00:00:00Z");
    expect(err.retryAfterSeconds).toBe(22 * 24 * 3600);
    expect(err.details).toMatchObject({
      resetAt: "2026-08-01T00:00:00Z",
      retryAfterSeconds: 22 * 24 * 3600,
    });
    expect(err.i18nParams?.["resetAt"]).toBe("2026-08-01T00:00:00Z");
    expect(err.message).toContain("Resets at 2026-08-01T00:00:00Z");
    expect(err.i18nKey).toBe("errors.cap.exceeded");
  });

  test("retryAfterSeconds rounds up and never goes negative", () => {
    const soon = new CapExceededError("c", 1, 1, tolerance, {
      resetAt: "2026-07-10T00:00:00.500Z",
      now,
    });
    expect(soon.retryAfterSeconds).toBe(1);
    const past = new CapExceededError("c", 1, 1, tolerance, {
      resetAt: "2026-07-01T00:00:00Z",
      now,
    });
    expect(past.retryAfterSeconds).toBe(0);
  });

  test("custom i18nKey replaces the default", () => {
    const err = new CapExceededError("c", 1, 1, tolerance, { i18nKey: "x:errors.cap" });
    expect(err.i18nKey).toBe("x:errors.cap");
  });

  test("without resetAt (rolling cap) there is no retry info", () => {
    const err = new CapExceededError("c", 1, 1, tolerance);
    expect(err.resetAt).toBeUndefined();
    expect(err.retryAfterSeconds).toBeUndefined();
  });

  test("assertBelowHardCap defaults to the month end, honors periodEndIso, rejects an end before the start", () => {
    const cap = {
      capName: "c",
      limit: 1,
      profile: "hardSlot" as const,
      periodStartIso: "2026-07-01T00:00:00Z",
    };
    expect(() => assertBelowHardCap(1, cap)).toThrow(
      expect.objectContaining({ resetAt: "2026-08-01T00:00:00Z" }),
    );
    expect(() => assertBelowHardCap(1, { ...cap, periodEndIso: "2026-07-15T00:00:00Z" })).toThrow(
      expect.objectContaining({ resetAt: "2026-07-15T00:00:00Z" }),
    );
    expect(() => assertBelowHardCap(1, { ...cap, periodEndIso: "2026-07-01T00:00:00Z" })).toThrow(
      /must be after periodStartIso/,
    );
  });
});
