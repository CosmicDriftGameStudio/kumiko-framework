import { createEntityExecutor, type HandlerContext } from "@kumiko/framework/engine";
import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { capCounterEntity } from "./entity";

const { table } = createEntityExecutor("cap-counter", capCounterEntity);

// =============================================================================
// Cap-Toleranz-Multipliers
// =============================================================================

/**
 * Cap-Toleranz-Profile — pro Cap-Typ asymmetrisch. Quelle: Memory
 * `project_pricing_byok_caps` §3 + `docs/plans/marketing/produkt/
 * pricing.md` Cap-Verhalten-Block.
 *
 * **Soft** = Notification-Schwelle (Multiplier × Limit). Bei
 * Erreichen wird einmalig gewarnt (lastSoftWarnedAt setzt das Flag).
 * Caller-Code emittiert die echte Notification.
 *
 * **Hard** = Schreibe-Block (Multiplier × Limit). enforceCap throwt
 * mit `cap_exceeded`-Error → Dispatcher mapped 429 + Upgrade-Hint.
 */
export type CapToleranceProfile = {
  readonly soft: number;
  readonly hard: number;
};

export const CAP_TOLERANCES = {
  /** Mails / Tokens — billig, BYOK ab Pro. Burst-Buffer großzügig. */
  burstable: { soft: 1.1, hard: 1.2 },
  /** DB-Storage / File-Storage — teuer + persistent. Strikter Cut. */
  storage: { soft: 1.0, hard: 1.05 },
  /** Apps-Count, Plattform-Slots — gebuchte Kapazität, kein Buffer. */
  hardSlot: { soft: 1.0, hard: 1.0 },
  /** Egress — Bursty-Traffic legitim, nur extreme Spikes blockieren. */
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
 * transaction, the dispatcher maps the error to HTTP 429 with the
 * upgrade-hint shape (see CapExceededError below).
 *
 * **Sync read implication:** the counter reflects the state at this
 * exact transaction. Two parallel writes can each see "value < hard"
 * and both pass — that's a race. Cap-tolerance-buffers (soft 110% /
 * hard 120% for burstable caps) cover this; truly hard slots
 * (apps-count) need stricter serialization at the create-handler
 * level (e.g. uniqueness-index on apps.tenantId+slot-number).
 */
export async function enforceCap(
  ctx: HandlerContext,
  options: {
    readonly capName: string;
    readonly periodStartIso: string;
    readonly limit: number;
    readonly profile: CapToleranceProfileName;
  },
): Promise<EnforceCapResult> {
  if (!ctx.db) {
    throw new Error("cap-counter.enforceCap: ctx.db missing — run inside a handler context");
  }

  const tolerance = CAP_TOLERANCES[options.profile];
  const softThreshold = options.limit * tolerance.soft;
  const hardThreshold = options.limit * tolerance.hard;

  const rows = await ctx.db
    .select()
    .from(table)
    .where(
      and(eq(table["capName"], options.capName), eq(table["periodStart"], options.periodStartIso)),
    )
    .limit(1);

  const row = rows[0];
  const value = row ? (row["value"] as number) : 0;

  if (value >= hardThreshold) {
    throw new CapExceededError(options.capName, options.limit, value, tolerance);
  }

  if (value >= softThreshold) {
    const lastSoftWarnedAt = row ? row["lastSoftWarnedAt"] : null;
    return { state: "soft-hit", value, crossed: lastSoftWarnedAt === null };
  }

  return { state: "ok", value };
}

// =============================================================================
// CapExceededError
// =============================================================================

/**
 * Thrown by enforceCap when value ≥ hard-threshold. Includes enough
 * context for the HTTP layer to render an actionable 429 — `code`
 * matches the framework's error-contract pattern (kebab + scope).
 *
 * Caller-side mapping example (in your dispatcher error-handler):
 *   if (err instanceof CapExceededError) {
 *     return c.json(
 *       { error: { code: err.code, message: err.message, capName: err.capName, ... } },
 *       429,
 *     );
 *   }
 */
export class CapExceededError extends Error {
  readonly code = "cap_exceeded" as const;
  constructor(
    readonly capName: string,
    readonly limit: number,
    readonly currentValue: number,
    readonly tolerance: CapToleranceProfile,
  ) {
    super(
      `Cap "${capName}" exceeded: current=${currentValue}, limit=${limit}, hard-threshold=${limit * tolerance.hard}. Upgrade tier or wait for next period reset.`,
    );
    this.name = "CapExceededError";
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

/**
 * Rolling-window sentinel. Use this for caps that filter by event-
 * timestamp at read-time (e.g. AI-tokens-7day) — the aggregate-stream
 * stays one row, periodStart is just an identity-anchor.
 *
 * Returns "1970-01-01T00:00:00Z" — meaningful zero, not a typo.
 */
export const ROLLING_WINDOW_PERIOD = "1970-01-01T00:00:00Z" as const;
