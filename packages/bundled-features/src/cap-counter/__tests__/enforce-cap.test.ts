// Pure unit tests for the enforce-cap helpers. Mocks ctx.db's
// select-chains via tiny in-memory stubs so we hit every branch
// without spinning up the test-stack — the real event-store +
// dispatcher integration is exercised in cap-counter.integration.ts.

import { describe, expect, mock, test } from "bun:test";
// Temporal: rely on the global ambient declaration from temporal-spec.
// The framework polyfill is loaded by setupTestStack, but pure unit
// tests (no stack) need a manual polyfill — vitest.setup.ts does that.
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  assertBelowHardCap,
  CAP_TOLERANCES,
  CapExceededError,
  calendarMonthPeriodEndIso,
  currentCalendarMonthStartIso,
  enforceCap,
  enforceCapAndMaybeNotify,
} from "../enforce-cap.ts";

// Test-mock: ctx.db exposes TenantDb-style selectMany (production path)
// plus legacy drizzle .select().from().where() chain stubs.

function makeMockDb(rows: unknown[]) {
  // Honors the event `type` filter; every other filter is ignored.
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
// enforceCapAndMaybeNotify — Calendar + Notification-Wiring
// =============================================================================

describe("enforceCapAndMaybeNotify — calendar", () => {
  const baseOpts = {
    capName: "mails-per-month",
    periodStartIso: PERIOD,
    limit: 1000,
    profile: "burstable" as const,
  };

  test("ok → notifier not called", async () => {
    const ctx = stubCalendarCtx([{ value: 100, lastSoftWarnedAt: null }]);
    const notify = mock();
    const result = await enforceCapAndMaybeNotify(ctx, { ...baseOpts, notify });
    expect(result.state).toBe("ok");
    expect(notify).not.toHaveBeenCalled();
  });

  // soft-hit crossed=true (notify payload + DB flag flip) needs the real
  // event-store executor, so it lives in cap-counter.integration.test.ts
  // scenario 6 instead of a mock-ctx test here.

  test("soft-hit, crossed=false (already warned) → notifier not called again", async () => {
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
// Period-Helpers
// =============================================================================

describe("currentCalendarMonthStartIso", () => {
  test("returns 1st of month at 00:00 UTC, ISO format", () => {
    const midMay = Temporal.Instant.from("2026-05-15T14:32:11Z");
    const result = currentCalendarMonthStartIso(midMay);
    expect(result).toBe("2026-05-01T00:00:00Z");
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

  test("without resetAt there is no retry info", () => {
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

  test("assertBelowHardCap rejects a misconfigured period even below the limit", () => {
    const cap = {
      capName: "c",
      limit: 10,
      profile: "hardSlot" as const,
      periodStartIso: "2026-07-01T00:00:00Z",
    };
    expect(() => assertBelowHardCap(0, { ...cap, periodEndIso: "2026-07-01T00:00:00Z" })).toThrow(
      /must be after periodStartIso/,
    );
    expect(() => assertBelowHardCap(0, { ...cap, periodEndIso: "not-a-date" })).toThrow();
    expect(() => assertBelowHardCap(0, cap)).not.toThrow();
  });
});
