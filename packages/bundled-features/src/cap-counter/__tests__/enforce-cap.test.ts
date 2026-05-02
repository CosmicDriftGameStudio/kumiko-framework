// Pure unit tests for the enforce-cap helper. Mocks ctx.db's select-
// chain via a tiny in-memory stub so we hit every branch (under-soft,
// soft-hit-fresh, soft-hit-already-warned, hard-hit) without spinning
// up the test-stack.

import { describe, expect, test } from "vitest";
import {
  CAP_TOLERANCES,
  CapExceededError,
  currentCalendarMonthStartIso,
  enforceCap,
  ROLLING_WINDOW_PERIOD,
} from "../enforce-cap";

// In-memory ctx.db stub — supports the chain `db.select().from(...).where(...).limit(1)`.
function stubCtx(rows: { value: number; lastSoftWarnedAt: unknown }[]) {
  const ctx = {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => rows,
          }),
        }),
      }),
    },
  };
  return ctx as unknown as Parameters<typeof enforceCap>[0];
}

const PERIOD = "2026-05-01T00:00:00Z";

describe("enforceCap — burstable profile (mails / tokens)", () => {
  const opts = {
    capName: "mails-per-month",
    periodStartIso: PERIOD,
    limit: 1000,
    profile: "burstable" as const,
  };

  test("value below soft-threshold → ok", async () => {
    const ctx = stubCtx([{ value: 500, lastSoftWarnedAt: null }]);
    const result = await enforceCap(ctx, opts);
    expect(result.state).toBe("ok");
    if (result.state === "ok") {
      expect(result.value).toBe(500);
    }
  });

  test("no row exists yet → value=0, ok", async () => {
    const ctx = stubCtx([]);
    const result = await enforceCap(ctx, opts);
    expect(result.state).toBe("ok");
    if (result.state === "ok") {
      expect(result.value).toBe(0);
    }
  });

  test("value at soft-threshold (1100, soft=1.1) → soft-hit, crossed=true on first warn", async () => {
    const ctx = stubCtx([{ value: 1100, lastSoftWarnedAt: null }]);
    const result = await enforceCap(ctx, opts);
    expect(result.state).toBe("soft-hit");
    if (result.state === "soft-hit") {
      expect(result.value).toBe(1100);
      expect(result.crossed).toBe(true);
    }
  });

  test("value past soft, already warned → soft-hit, crossed=false (no re-notification)", async () => {
    const ctx = stubCtx([{ value: 1150, lastSoftWarnedAt: "2026-05-15T12:00:00Z" }]);
    const result = await enforceCap(ctx, opts);
    expect(result.state).toBe("soft-hit");
    if (result.state === "soft-hit") {
      expect(result.crossed).toBe(false);
    }
  });

  test("value at hard-threshold (1200, hard=1.2) → throws CapExceededError", async () => {
    const ctx = stubCtx([{ value: 1200, lastSoftWarnedAt: null }]);
    await expect(enforceCap(ctx, opts)).rejects.toThrow(CapExceededError);
  });

  test("CapExceededError carries cap-name + limit + currentValue", async () => {
    const ctx = stubCtx([{ value: 1500, lastSoftWarnedAt: null }]);
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
    const ctx = stubCtx([{ value: 10240, lastSoftWarnedAt: null }]);
    const result = await enforceCap(ctx, {
      capName: "db-storage-mb",
      periodStartIso: ROLLING_WINDOW_PERIOD,
      limit: 10240,
      profile: "storage",
    });
    expect(result.state).toBe("soft-hit");
  });

  test("at 1.05× limit (storage hard) → throws", async () => {
    const ctx = stubCtx([{ value: 10752, lastSoftWarnedAt: null }]);
    await expect(
      enforceCap(ctx, {
        capName: "db-storage-mb",
        periodStartIso: ROLLING_WINDOW_PERIOD,
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
    const ctx = stubCtx([{ value: 5, lastSoftWarnedAt: null }]);
    await expect(
      enforceCap(ctx, {
        capName: "apps-count",
        periodStartIso: ROLLING_WINDOW_PERIOD,
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

describe("currentCalendarMonthStartIso", () => {
  test("returns 1st of month at 00:00 UTC, ISO format", () => {
    // Pick a fixed instant in mid-month — function should snap to 1st.
    const { Temporal } = require("temporal-polyfill");
    const midMay = Temporal.Instant.from("2026-05-15T14:32:11Z");
    const result = currentCalendarMonthStartIso(midMay);
    expect(result).toBe("2026-05-01T00:00:00Z");
  });
});
