import { createEntityExecutor, type HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { KumikoError } from "@cosmicdrift/kumiko-framework/errors";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { rollingCapAggregateId } from "./aggregate-id";
import {
  CAP_COUNTER_ROLLING_AGGREGATE_TYPE,
  CapCounterHandlers,
  ROLLING_INCREMENTED_EVENT_QN,
} from "./constants";
import { capCounterEntity } from "./entity";

// Temporal globally provided by the framework's polyfill init
// (ensureTemporalPolyfill() in time/polyfill.ts, called from
// setupTestStack/boot). Importing from "temporal-polyfill" gives us
// the polyfill-package types which don't quite match drizzle's
// `instant()`-customType (temporal-spec narrowing of `until(...).sign`).
// Mirror the audit-handler pattern: rely on the global ambient
// declaration from temporal-spec.

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
 * transaction; `CapExceededError` extends `KumikoError` so the dispatcher
 * auto-maps it to HTTP 429 (see CapExceededError below).
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

  const rows = await ctx.db.selectMany(
    table,
    { capName: options.capName, periodStart: options.periodStartIso },
    { limit: 1 },
  );

  const row = rows[0];
  const value = row ? (row["value"] as number) : 0; // @cast-boundary db-row

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
// Enforce-Rolling-Cap helper
// =============================================================================

/**
 * Synchronous read-and-check of the calling tenant's Rolling-Window-
 * Counter for `capName`. Reads the increment-events of the last
 * `windowDays` from the event-store and sums their `amount`. Returns:
 *   - "ok" when sum < soft-threshold
 *   - "soft-hit" when soft ≤ sum < hard.
 *
 * **Throws** `CapExceededError` when sum ≥ hard-threshold.
 *
 * **`crossed`-flag fehlt absichtlich:** Anders als der Calendar-
 * Counter hat das Rolling-Aggregate keine projection-row mit
 * `lastSoftWarnedAt`-Flag. Dedup gegen Notification-Storm passiert
 * im Caller (eigener key in einer Cache-Tabelle, oder einfache
 * memoization für die Lebensdauer des Request). Der Result-Shape
 * matcht trotzdem `EnforceCapResult` damit der gleiche Caller-Code
 * gegen beide Funktionen funktioniert; `crossed` ist hier immer
 * `false` (= "wir tracken's nicht").
 *
 * **Performance-Note:** der Read summiert ALLE Events im Window für
 * (tenant, capName). Bei 10k+ Events/Tenant in der Window könnte
 * das langsam werden — dann Migration auf eine Multi-Stream-
 * Projection mit pre-aggregierten daily-buckets. Heute nicht
 * vorgezogen.
 */
export async function enforceRollingCap(
  ctx: HandlerContext,
  options: {
    readonly capName: string;
    readonly windowDays: number;
    readonly limit: number;
    readonly profile: CapToleranceProfileName;
  },
): Promise<EnforceCapResult> {
  if (!ctx.db) {
    throw new Error("cap-counter.enforceRollingCap: ctx.db missing — run inside a handler context");
  }
  if (!ctx.user?.tenantId) {
    throw new Error(
      "cap-counter.enforceRollingCap: ctx.user.tenantId missing — required to compute aggregate-id",
    );
  }

  const tolerance = CAP_TOLERANCES[options.profile];
  const softThreshold = options.limit * tolerance.soft;
  const hardThreshold = options.limit * tolerance.hard;

  const aggregateId = rollingCapAggregateId(ctx.user.tenantId, options.capName);
  const cutoff = Temporal.Now.instant().subtract({ hours: options.windowDays * 24 });

  // events_tenant_type_idx (tenant_id, aggregate_type, created_at)
  // covers the prefix; the additional aggregate_id eq narrows to the
  // single rolling-stream. Postgres can use the index even with the
  // aggregate_id filter applied as a residual.
  const rows = await ctx.db.selectMany<{ payload: { amount?: number } }>(eventsTable, {
    tenantId: ctx.user.tenantId,
    aggregateType: CAP_COUNTER_ROLLING_AGGREGATE_TYPE,
    aggregateId,
    type: ROLLING_INCREMENTED_EVENT_QN,
    createdAt: { gte: cutoff },
  });

  let value = 0;
  for (const row of rows) {
    // @cast-boundary engine-payload — events.payload is jsonb (typed as
    // unknown by drizzle's $type<Record<string,unknown>>); narrowing
    // the shape here is a deliberate read-side contract for the
    // rolling-incremented-event we authored.
    const payload = row["payload"] as { amount?: number };
    if (typeof payload.amount === "number") {
      value += payload.amount;
    }
  }

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
 */
export class CapExceededError extends KumikoError {
  readonly code = "cap_exceeded" as const;
  readonly httpStatus = 429;

  constructor(
    readonly capName: string,
    readonly limit: number,
    readonly currentValue: number,
    readonly tolerance: CapToleranceProfile,
  ) {
    super({
      message: `Cap "${capName}" exceeded: current=${currentValue}, limit=${limit}, hard-threshold=${limit * tolerance.hard}. Upgrade tier or wait for next period reset.`,
      i18nKey: "errors.cap.exceeded",
      i18nParams: { capName, limit, currentValue },
      details: { capName, limit, currentValue, tolerance },
    });
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

// =============================================================================
// Notification-Wiring helpers — convenience-wrapper für enforceCap +
// enforceRollingCap, die einen Caller-supplied delivery-emit beim
// soft-hit-crossing ausführen. Cap-counter kennt delivery-feature
// nicht direkt — der Caller injiziert den emitter.
// =============================================================================

/**
 * Soft-hit-notifier callback. Caller liefert die Funktion die ein
 * delivery-event emittet (z.B. `delivery.send({to, template, payload})`).
 * Wird genau einmal pro Period beim Calendar-Counter aufgerufen
 * (`crossed === true` deduplicated via `markSoftWarnedHandler`).
 *
 * Beim Rolling-Counter ist `crossed` immer `false` — der Caller muss
 * dort selbst dedup'en (oder bewusst pro request feuern lassen).
 */
export type SoftHitNotifier = (info: {
  readonly capName: string;
  readonly value: number;
  readonly limit: number;
  readonly tenantId: string;
}) => Promise<void> | void;

/**
 * Calendar-Period-enforcement + automatische soft-hit-Notification.
 * Ruft `enforceCap`, bei `crossed: true` den Notifier UND
 * `mark-soft-warned`-Handler (flippt `lastSoftWarnedAt` damit der
 * nächste Aufruf in derselben Period nicht erneut feuert).
 *
 * Returnt das `EnforceCapResult` weiter — Caller kann die Logik
 * verzweigen (z.B. UI-Toast bei soft-hit zusätzlich zur
 * Email-Notification).
 */
export async function enforceCapAndMaybeNotify(
  ctx: HandlerContext,
  options: {
    readonly capName: string;
    readonly periodStartIso: string;
    readonly limit: number;
    readonly profile: CapToleranceProfileName;
    readonly notify: SoftHitNotifier;
  },
): Promise<EnforceCapResult> {
  const result = await enforceCap(ctx, {
    capName: options.capName,
    periodStartIso: options.periodStartIso,
    limit: options.limit,
    profile: options.profile,
  });

  if (result.state === "soft-hit" && result.crossed) {
    if (!ctx.user?.tenantId) {
      throw new Error(
        "cap-counter.enforceCapAndMaybeNotify: ctx.user.tenantId missing — required for notification",
      );
    }
    await options.notify({
      capName: options.capName,
      value: result.value,
      limit: options.limit,
      tenantId: ctx.user.tenantId,
    });
    // Flip the soft-warned flag so the same period doesn't re-notify.
    // We're already inside a write-handler-context, so dispatching the
    // mark-soft-warned-handler in-line works via ctx.write (re-uses
    // the request user; the handler's own access-check enforces the
    // SystemAdmin role on the caller).
    await ctx.write(CapCounterHandlers.markSoftWarned, {
      capName: options.capName,
      periodStartIso: options.periodStartIso,
    });
  }

  return result;
}

/**
 * Rolling-Window-enforcement + immer-feuert-Notification beim soft-hit.
 *
 * **Achtung Storm-Risk:** Rolling-Counter trackt `lastSoftWarnedAt`
 * NICHT (kein projection-row). Bei jedem Aufruf während der Counter
 * im soft-Bereich ist, feuert der notifier. Der Caller muss
 * dedup'en — z.B. via Cache-Eintrag `lastNotified[capName]` mit TTL,
 * oder er ruft `enforceRollingCapAndMaybeNotify` nur einmal pro
 * Tag/Stunde auf (Hourly-Cron statt pro Request).
 */
export async function enforceRollingCapAndMaybeNotify(
  ctx: HandlerContext,
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
    if (!ctx.user?.tenantId) {
      throw new Error(
        "cap-counter.enforceRollingCapAndMaybeNotify: ctx.user.tenantId missing — required for notification",
      );
    }
    await options.notify({
      capName: options.capName,
      value: result.value,
      limit: options.limit,
      tenantId: ctx.user.tenantId,
    });
  }

  return result;
}

// =============================================================================
// Stock-Cap (Bestand) — live-gezählte Kardinalität gegen Tier-Limit
// =============================================================================

export type StockCapResult =
  | { readonly state: "ok"; readonly current: number; readonly limit: number }
  | { readonly state: "exceeded"; readonly current: number; readonly limit: number };

/**
 * Stock-Cap: prüft eine vom Caller LIVE gezählte Kardinalität (z.B. Anzahl
 * existierender Components eines Tenants) gegen ein Tier-Limit.
 *
 * Anders als {@link enforceCap}/{@link enforceRollingCap} gibt es KEINEN
 * gespeicherten Counter: der Caller zählt die Projektion selbst
 * (`count(*) WHERE tenant_id = …`) und übergibt `current`. Das ist drift-frei
 * (ein Delete gibt den Slot sofort frei), braucht keine Counter-Tabelle und
 * kein Increment/Decrement-Bookkeeping. Misst einen Bestand, keinen Fluss.
 *
 * **TOCTOU-Caveat:** Zählen und Schreiben sind nicht atomar — zwei parallele
 * Creates können beide `ok` sehen und das Limit um eins überschreiten (gleiche
 * Race wie bei {@link enforceCap}). Exakt harte Slots brauchen zusätzliche
 * Serialisierung im Create-Pfad (z.B. Unique-Index auf tenantId+slot).
 *
 * Reine Funktion — wirft NICHT und mappt KEINEN HTTP-Status. Ein erreichtes
 * Stock-Limit heißt „Upgrade nötig", nicht „retry later" (429): der Caller
 * entscheidet die Reaktion, typisch ein app-eigener 422/`upgrade_required`
 * mit i18n. Mit `hardSlot` (soft=hard=1.0) ist die Grenze exakt `limit`.
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
