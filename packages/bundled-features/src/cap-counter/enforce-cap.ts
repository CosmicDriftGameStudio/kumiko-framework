import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { KumikoError, reraiseAsKumikoError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  type CapCounterContext,
  markCapSoftWarned,
  readRollingCapUsage,
  resolveCapCounterScope,
} from "./book-cap-usage.ts";
import { capCounterEntity } from "./entity.ts";

const { table } = createEntityExecutor("cap-counter", capCounterEntity);

// =============================================================================
// Cap-Toleranz-Multipliers
// =============================================================================

/**
 * Cap-tolerance profiles, asymmetric by cap type.
 *
 * **Soft** = notification threshold (multiplier × limit). Once reached,
 * a warning is issued (`lastSoftWarnedAt` sets the flag); caller code emits
 * the actual notification.
 *
 * **Hard** = write-block threshold (multiplier × limit). `enforceCap` throws
 * a `cap_exceeded` error, which the dispatcher maps to 429 with an upgrade hint.
 */
export type CapToleranceProfile = {
  readonly soft: number;
  readonly hard: number;
};

export const CAP_TOLERANCES = {
  /** Mails / tokens — inexpensive, with BYOK available from Pro. Generous burst buffer. */
  burstable: { soft: 1.1, hard: 1.2 },
  /** DB-Storage / File-Storage — teuer + persistent. Strikter Cut. */
  storage: { soft: 1.0, hard: 1.05 },
  /** App count and platform slots — purchased capacity, with no buffer. */
  hardSlot: { soft: 1.0, hard: 1.0 },
  /** Egress — bursty traffic is legitimate; only extreme spikes are blocked. */
  egress: { soft: 1.1, hard: 1.3 },
} as const satisfies Readonly<Record<string, CapToleranceProfile>>;

export type CapToleranceProfileName = keyof typeof CAP_TOLERANCES;

// =============================================================================
// Enforcement-Result
// =============================================================================

export type EnforceCapResult =
  /** Counter < softLimit. No action. */
  | { readonly state: "ok"; readonly value: number }
  /** softLimit ≤ counter < hardLimit. Warning emitted iff first time. */
  | {
      readonly state: "soft-hit";
      readonly value: number;
      /** True if this call CROSSED the soft-threshold and notified. */
      readonly crossed: boolean;
    };

export function assertBelowHardCap(
  valueSeenByLastUnit: number,
  cap: {
    readonly capName: string;
    readonly limit: number;
    readonly profile: CapToleranceProfileName;
    // Rolling caps have no fixed period, so they pass neither period field.
    readonly periodStartIso?: string;
    readonly periodEndIso?: string;
    readonly i18nKey?: string;
  },
): void {
  const tolerance = CAP_TOLERANCES[cap.profile];
  // Validated on every call so a misconfigured period fails deterministically, not only at the limit.
  const resetAt = resolvePeriodEndIso(cap.periodStartIso, cap.periodEndIso);
  if (valueSeenByLastUnit >= cap.limit * tolerance.hard) {
    throw new CapExceededError(cap.capName, cap.limit, valueSeenByLastUnit, tolerance, {
      ...(resetAt !== undefined && { resetAt }),
      ...(cap.i18nKey !== undefined && { i18nKey: cap.i18nKey }),
    });
  }
}

function resolvePeriodEndIso(
  periodStartIso: string | undefined,
  periodEndIso: string | undefined,
): string | undefined {
  if (periodStartIso === undefined) return periodEndIso;
  if (periodEndIso === undefined) return calendarMonthPeriodEndIso(periodStartIso);
  const start = Temporal.Instant.from(periodStartIso);
  const end = Temporal.Instant.from(periodEndIso);
  if (Temporal.Instant.compare(end, start) <= 0) {
    throw new Error(
      `cap-counter: periodEndIso (${periodEndIso}) must be after periodStartIso (${periodStartIso})`,
    );
  }
  return end.toString();
}

// =============================================================================
// Enforce-Cap helper
// =============================================================================

/**
 * Synchronous read-and-check of the calling tenant's counter for
 * (capName, period). Returns:
 *   - "ok" when value < soft-threshold
 *   - "soft-hit" when soft ≤ value < hard, with `crossed=true` on the
 *     first hit per period (caller emits notification, then calls
 *     mark-soft-warned to flip the flag)
 *
 * **Throws** `CapExceededError` when value ≥ hard-threshold. Pre-save
 * hooks call this BEFORE the actual write — the throw rolls back the
 * transaction; `CapExceededError` extends `KumikoError` so the dispatcher
 * auto-maps it to HTTP 429 (see CapExceededError below).
 *
 * **Sync read implication:** the counter reflects the state at this
 * exact transaction. Two parallel writes can each see "value < hard"
 * and both pass — that's a race (withCapEnforcement closes it with an atomic reservation;
 * bare enforceCap stays a read). Cap-tolerance-buffers (soft 110% /
 * hard 120% for burstable caps) cover this; truly hard slots
 * (apps-count) need stricter serialization at the create-handler
 * level (e.g. uniqueness-index on apps.tenantId+slot-number).
 */
export async function enforceCap(
  ctx: CapCounterContext,
  options: {
    readonly capName: string;
    readonly periodStartIso: string;
    readonly limit: number;
    readonly profile: CapToleranceProfileName;
    // Units the caller is about to book in one go (default 1), checked with
    // the same outcome as booking them one by one.
    readonly amount?: number;
    // Default: end of the calendar month that starts at periodStartIso.
    readonly periodEndIso?: string;
    readonly i18nKey?: string;
  },
): Promise<EnforceCapResult> {
  const { user, readDb } = resolveCapCounterScope(ctx, false);

  const amount = options.amount ?? 1;
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(
      `cap-counter.enforceCap: amount must be a positive integer, got ${options.amount}`,
    );
  }

  const tolerance = CAP_TOLERANCES[options.profile];
  const softThreshold = options.limit * tolerance.soft;

  const rows = await readDb.selectMany(
    table,
    { tenantId: user.tenantId, capName: options.capName, periodStart: options.periodStartIso },
    { limit: 1 },
  );

  const row = rows[0];
  const storedValue = row ? (row["value"] as number) : 0; // @cast-boundary db-row
  // The last of `amount` units sees this value before its own increment.
  const value = storedValue + amount - 1;

  assertBelowHardCap(value, options);

  if (value >= softThreshold) {
    const lastSoftWarnedAt = row ? row["lastSoftWarnedAt"] : null;
    return { state: "soft-hit", value, crossed: lastSoftWarnedAt === null };
  }

  return { state: "ok", value };
}

// =============================================================================
// Enforce-Rolling-Cap helper
// =============================================================================

/**
 * Synchronous read-and-check of the calling tenant's rolling-window
 * counter for `capName`. Reads increment events from the last
 * `windowDays` in the event store and sums their `amount`. Returns:
 *   - "ok" when sum < soft-threshold
 *   - "soft-hit" when soft ≤ sum < hard.
 *
 * **Throws** `CapExceededError` when sum ≥ hard-threshold.
 *
 * **The `crossed` flag is intentionally absent:** Unlike the calendar
 * counter, the rolling aggregate has no projection row with a
 * `lastSoftWarnedAt` flag. The caller must deduplicate notification storms
 * using its own mechanism, such as a cache-table key or request-lifetime
 * memoization. The result shape still matches `EnforceCapResult` so the same
 * caller code works with both functions; `crossed` is always `false` here
 * (= "not tracked").
 *
 * **Performance note:** The read sums ALL events in the window for
 * (tenant, capName). With 10k+ events per tenant in the window, this could
 * become slow; migrate to a multi-stream projection with pre-aggregated
 * daily buckets if needed.
 */
export async function enforceRollingCap(
  ctx: CapCounterContext,
  options: {
    readonly capName: string;
    readonly windowDays: number;
    readonly limit: number;
    readonly profile: CapToleranceProfileName;
  },
): Promise<EnforceCapResult> {
  const { user, readDb } = resolveCapCounterScope(ctx, false);

  const tolerance = CAP_TOLERANCES[options.profile];
  const softThreshold = options.limit * tolerance.soft;
  const hardThreshold = options.limit * tolerance.hard;

  const value = await readRollingCapUsage(readDb, user.tenantId, {
    capName: options.capName,
    windowDays: options.windowDays,
  });

  if (value >= hardThreshold) {
    throw new CapExceededError(options.capName, options.limit, value, tolerance);
  }

  if (value >= softThreshold) {
    return { state: "soft-hit", value, crossed: false };
  }

  return { state: "ok", value };
}

// =============================================================================
// CapExceededError
// =============================================================================

/**
 * Thrown by enforceCap/enforceRollingCap when value ≥ hard-threshold.
 * Extends `KumikoError` — the dispatcher auto-maps this to HTTP 429
 * with `code: "cap_exceeded"`, no caller-side catch needed.
 *
 * Calendar caps carry `resetAt` (end of the period) and `retryAfterSeconds`, which the API
 * answers as Retry-After. Rolling caps have no fixed reset instant, so both stay undefined.
 */
export class CapExceededError extends KumikoError {
  readonly code = "cap_exceeded" as const;
  readonly httpStatus = 429;
  readonly resetAt: string | undefined;

  constructor(
    readonly capName: string,
    readonly limit: number,
    readonly currentValue: number,
    readonly tolerance: CapToleranceProfile,
    options?: {
      readonly resetAt?: string;
      readonly i18nKey?: string;
      readonly cause?: Error;
      // Deterministic tests only.
      readonly now?: Temporal.Instant;
    },
  ) {
    const resetAt = options?.resetAt;
    const retryAfterSeconds =
      resetAt === undefined
        ? undefined
        : Math.max(
            0,
            Math.ceil(
              Temporal.Instant.from(resetAt).epochMilliseconds / 1000 -
                (options?.now ?? Temporal.Now.instant()).epochMilliseconds / 1000,
            ),
          );
    super({
      message: `Cap "${capName}" exceeded: current=${currentValue}, limit=${limit}, hard-threshold=${limit * tolerance.hard}. Upgrade tier or wait for next period reset.${resetAt === undefined ? "" : ` Resets at ${resetAt}.`}`,
      i18nKey: options?.i18nKey ?? "errors.cap.exceeded",
      i18nParams: { capName, limit, currentValue, ...(resetAt !== undefined && { resetAt }) },
      details: {
        capName,
        limit,
        currentValue,
        tolerance,
        ...(resetAt !== undefined && { resetAt, retryAfterSeconds }),
      },
      ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
      ...(options?.cause && { cause: options.cause }),
    });
    this.resetAt = resetAt;
  }
}

// =============================================================================
// Period-Helpers
// =============================================================================

/**
 * Calendar-month period start in UTC. Use this for monthly caps
 * (mails, egress).
 *
 * Returns ISO string for the 1st of the current month at 00:00 UTC.
 */
export function currentCalendarMonthStartIso(
  now: Temporal.Instant = Temporal.Now.instant(),
): string {
  const zoned = now.toZonedDateTimeISO("UTC");
  const start = zoned.with({
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });
  return start.toInstant().toString();
}

export function calendarMonthPeriodEndIso(periodStartIso: string): string {
  return Temporal.Instant.from(periodStartIso)
    .toZonedDateTimeISO("UTC")
    .add({ months: 1 })
    .toInstant()
    .toString();
}

// =============================================================================
// Notification-wiring helpers — convenience wrappers for `enforceCap` and
// `enforceRollingCap` that execute a caller-supplied delivery emitter when
// a soft-hit threshold is crossed. The cap counter does not know about the
// delivery feature directly; the caller injects the emitter.
// =============================================================================

/**
 * Soft-hit notifier callback. The caller supplies the function that emits
 * a delivery event (for example, `delivery.send({to, template, payload})`).
 * It is called exactly once per period for the calendar counter
 * (`crossed === true`, deduplicated via `markSoftWarnedHandler`).
 *
 * For the rolling counter, `crossed` is always `false`; the caller must
 * deduplicate notifications itself or intentionally send one per request.
 */
export type SoftHitNotifier = (info: {
  readonly capName: string;
  readonly value: number;
  readonly limit: number;
  readonly tenantId: string;
}) => Promise<void> | void;

/**
 * Calendar-period enforcement with automatic soft-hit notification.
 * Calls `enforceCap`; when `crossed: true`, it calls the notifier and the
 * `mark-soft-warned` handler, which flips `lastSoftWarnedAt` so that the
 * same period does not trigger another notification.
 *
 * Returns the `EnforceCapResult` unchanged, allowing the caller to branch
 * on the result, such as showing a UI toast in addition to the email
 * notification.
 */
export async function enforceCapAndMaybeNotify(
  ctx: CapCounterContext,
  options: {
    readonly capName: string;
    readonly periodStartIso: string;
    readonly limit: number;
    readonly profile: CapToleranceProfileName;
    readonly notify: SoftHitNotifier;
    readonly amount?: number;
    readonly periodEndIso?: string;
    readonly i18nKey?: string;
    readonly markSoftWarnedOutsideTransaction?: boolean;
  },
): Promise<EnforceCapResult> {
  const result = await enforceCap(ctx, {
    capName: options.capName,
    periodStartIso: options.periodStartIso,
    limit: options.limit,
    profile: options.profile,
    ...(options.amount !== undefined && { amount: options.amount }),
    ...(options.periodEndIso !== undefined && { periodEndIso: options.periodEndIso }),
    ...(options.i18nKey !== undefined && { i18nKey: options.i18nKey }),
  });

  if (result.state === "soft-hit" && result.crossed) {
    await options.notify({
      capName: options.capName,
      value: result.value,
      limit: options.limit,
      tenantId: resolveCapCounterScope(ctx, false).user.tenantId,
    });
    // Flip the soft-warned flag so the same period doesn't re-notify.
    const marked = await markCapSoftWarned(ctx, {
      capName: options.capName,
      periodStartIso: options.periodStartIso,
      ...(options.markSoftWarnedOutsideTransaction && { outsideTransaction: true }),
    });
    if (!marked.isSuccess) throw reraiseAsKumikoError(marked.error);
  }

  return result;
}

/**
 * Rolling-window enforcement that always sends a notification on a soft hit.
 *
 * **Storm risk:** The rolling counter does NOT track `lastSoftWarnedAt`
 * (there is no projection row). On every call while the counter is in the
 * soft range, the notifier fires. The caller must deduplicate, for example
 * with a cache entry `lastNotified[capName]` and a TTL, or call
 * `enforceRollingCapAndMaybeNotify` only once per day or hour
 * (an hourly cron instead of per request).
 */
export async function enforceRollingCapAndMaybeNotify(
  ctx: CapCounterContext,
  options: {
    readonly capName: string;
    readonly windowDays: number;
    readonly limit: number;
    readonly profile: CapToleranceProfileName;
    readonly notify: SoftHitNotifier;
  },
): Promise<EnforceCapResult> {
  const result = await enforceRollingCap(ctx, {
    capName: options.capName,
    windowDays: options.windowDays,
    limit: options.limit,
    profile: options.profile,
  });

  if (result.state === "soft-hit") {
    await options.notify({
      capName: options.capName,
      value: result.value,
      limit: options.limit,
      tenantId: resolveCapCounterScope(ctx, false).user.tenantId,
    });
  }

  return result;
}

// =============================================================================
// Stock cap — live-counted cardinality checked against the tier limit
// =============================================================================

export type StockCapResult =
  | { readonly state: "ok"; readonly current: number; readonly limit: number }
  | { readonly state: "exceeded"; readonly current: number; readonly limit: number };

/**
 * Stock cap: checks a cardinality counted LIVE by the caller (for example,
 * the number of existing components for a tenant) against a tier limit.
 *
 * Unlike {@link enforceCap}/{@link enforceRollingCap}, there is NO stored
 * counter: the caller counts the projection itself
 * (`count(*) WHERE tenant_id = …`) and passes `current`. This avoids drift
 * (a delete immediately frees the slot), requires no counter table or
 * increment/decrement bookkeeping, and measures a stock rather than a flow.
 *
 * **TOCTOU caveat:** Counting and writing are not atomic—two concurrent
 * creates can both see `ok` and exceed the limit by one (the same race as
 * with {@link enforceCap}). Strictly hard slots need additional
 * serialization in the create path, such as a unique index on
 * tenantId+slot.
 *
 * Pure function—it does NOT throw or map an HTTP status. Reaching a stock
 * limit means "upgrade required", not "retry later" (429); the caller
 * chooses the response, typically an app-specific 422/`upgrade_required`
 * with i18n. With `hardSlot` (soft=hard=1.0), the boundary is exactly `limit`.
 */
export function enforceStockCap(options: {
  readonly current: number;
  readonly limit: number;
  readonly profile: CapToleranceProfileName;
}): StockCapResult {
  const hardThreshold = options.limit * CAP_TOLERANCES[options.profile].hard;
  const state = options.current >= hardThreshold ? "exceeded" : "ok";
  return { state, current: options.current, limit: options.limit };
}
