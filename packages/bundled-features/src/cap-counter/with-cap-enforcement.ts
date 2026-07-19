// withCapEnforcement / withRollingCapEnforcement — handler-wrapper die
// pre-call enforceCap-And-Notify + post-call increment um den
// gewrappten Handler legen.
//
// **Warum Wrapper statt manuelle Calls im Handler:**
// Pattern-konsistenz. Wer einen cap-bedingten Handler schreibt,
// darf nicht vergessen den counter zu incrementen oder den enforce-
// pre-call zu machen — beides ist atomic-mit-dem-Handler-zusammen.
// Wrapper macht das Pattern explizit + co-located.
//
// **Atomicity-Vorbehalt:** Pre-enforce + Handler + Post-Increment
// laufen in DREI getrennten Transaktionen (Dispatcher öffnet jede
// ctx.write-call eine eigene). Bei einem Crash zwischen Handler-
// Success und Post-Increment kommt der Counter unter — Tenant
// kriegt 1-2 Mails extra. Akzeptabel weil Cap-Toleranzen (110/120%)
// genau für solche Drift-Fälle gebaut sind.
//
// **Kein automatic markSoftWarned:** das passiert in
// enforceCapAndMaybeNotify drin (siehe enforce-cap.ts). Wrapper ruft
// nur den Helper, der den write dispatched.

import type {
  HandlerContext,
  WriteEvent,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { CapCounterHandlers } from "./constants";
import {
  type CapToleranceProfileName,
  enforceCapAndMaybeNotify,
  enforceRollingCapAndMaybeNotify,
  type SoftHitNotifier,
} from "./enforce-cap";

// =============================================================================
// Calendar-Period-Wrapper
// =============================================================================

/**
 * Pro-call dynamische Cap-Definition. Wird vor jedem Handler-Aufruf
 * neu evaluiert — typischer Caller liest hier den Tenant-Tier aus
 * dem ctx, mappt ihn auf einen Limit-Wert. `amount` default 1 (count-
 * events); für byte/token-cap übergibt der Caller die Größe aus
 * `event.payload`.
 */
export type CalendarCapDef = {
  readonly capName: string;
  readonly periodStartIso: string;
  readonly limit: number;
  readonly profile: CapToleranceProfileName;
  /** Increment-amount post-success. Default 1. */
  readonly amount?: number;
  readonly notify: SoftHitNotifier;
};

/** Resolver-fn that the wrapper calls before each handler invocation
 *  to compute the cap-spec for THIS request (e.g. limit derived from
 *  tenant-tier). Sync OR async — async lets the caller fetch the
 *  tier from DB. */
export type CalendarCapResolver = (
  event: WriteEvent,
  ctx: HandlerContext,
) => Promise<CalendarCapDef> | CalendarCapDef;

/**
 * Wrap a write-handler with calendar-period cap-enforcement.
 *
 * Flow:
 *   1. resolve cap-spec via `capResolver(event, ctx)`
 *   2. pre-call: `enforceCapAndMaybeNotify` — throws CapExceededError
 *      on hard-hit (handler never runs), notifies on soft-hit-crossing
 *   3. invoke the wrapped handler
 *   4. post-success: dispatch `cap-counter:write:increment` with `amount`
 *
 * The returned handler-def keeps the original name/schema/access
 * untouched — only the handler-fn is wrapped. The dispatcher sees
 * the same external contract.
 */
export function withCapEnforcement(
  handler: WriteHandlerDef,
  capResolver: CalendarCapResolver,
): WriteHandlerDef {
  return {
    name: handler.name,
    schema: handler.schema,
    access: handler.access,
    handler: async (event, ctx) => {
      const cap = await capResolver(event, ctx);

      // Pre-enforce. Hard-hit throws CapExceededError (extends KumikoError,
      // dispatcher auto-maps to HTTP 429 + cap_exceeded). Soft-hit-crossing
      // notifies via the supplied notifier + flips lastSoftWarnedAt.
      await enforceCapAndMaybeNotify(ctx, {
        capName: cap.capName,
        periodStartIso: cap.periodStartIso,
        limit: cap.limit,
        profile: cap.profile,
        notify: cap.notify,
      });

      const result = await handler.handler(event, ctx);

      // Post-success increment. Skip on failure so a failed write
      // doesn't burn cap-quota. amount default 1.
      if (result.isSuccess) {
        await ctx.write(CapCounterHandlers.increment, {
          capName: cap.capName,
          amount: cap.amount ?? 1,
          periodStartIso: cap.periodStartIso,
        });
      }

      return result;
    },
  };
}

// =============================================================================
// Rolling-Window-Wrapper
// =============================================================================

export type RollingCapDef = {
  readonly capName: string;
  readonly windowDays: number;
  readonly limit: number;
  readonly profile: CapToleranceProfileName;
  readonly amount?: number;
  readonly notify: SoftHitNotifier;
};

export type RollingCapResolver = (
  event: WriteEvent,
  ctx: HandlerContext,
) => Promise<RollingCapDef> | RollingCapDef;

/**
 * Wrap a write-handler with rolling-window cap-enforcement.
 *
 * Same flow as `withCapEnforcement` but uses
 * `enforceRollingCapAndMaybeNotify` + dispatches
 * `cap-counter:write:increment-rolling` post-success.
 *
 * **Notification-Storm-Caveat:** rolling-counter trackt KEIN
 * lastSoftWarnedAt — der Notifier feuert bei JEDEM Call solange
 * der counter im soft-Bereich ist. Caller sollte einen TTL-Cache
 * (`Map<capName, lastNotifiedAt>`) im notify-callback einbauen.
 */
export function withRollingCapEnforcement(
  handler: WriteHandlerDef,
  capResolver: RollingCapResolver,
): WriteHandlerDef {
  return {
    name: handler.name,
    schema: handler.schema,
    access: handler.access,
    handler: async (event, ctx) => {
      const cap = await capResolver(event, ctx);

      await enforceRollingCapAndMaybeNotify(ctx, {
        capName: cap.capName,
        windowDays: cap.windowDays,
        limit: cap.limit,
        profile: cap.profile,
        notify: cap.notify,
      });

      const result = await handler.handler(event, ctx);

      if (result.isSuccess) {
        await ctx.write(CapCounterHandlers.incrementRolling, {
          capName: cap.capName,
          amount: cap.amount ?? 1,
        });
      }

      return result;
    },
  };
}
