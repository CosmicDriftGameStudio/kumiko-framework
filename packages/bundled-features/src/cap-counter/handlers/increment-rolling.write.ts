// increment-rolling — Rolling-Window-Counter-Increment via Custom-
// Event statt CRUD/projection. Designed für Caps deren Wert sich
// kontinuierlich erneuern soll (KI-Tokens-7-Tage, Egress pro 24h).
//
// **Warum kein r.entity / CRUD wie der Calendar-Counter:** Der
// Calendar-Counter speichert den kumulierten value in seiner
// projection-row. Beim Period-Rollover wechselt die aggregate-id auf
// den neuen Period-Start, das ist der "Reset". Bei Rolling-Window
// gibt es keinen Rollover-Punkt — der Counter "rollt" kontinuierlich
// raus. Ein einzelner kumulativer value wäre falsch (würde monoton
// wachsen ohne Expiration). Die korrekte Read-Semantik ist: SUM aller
// Increment-Amounts der letzten N Tage. Dafür brauchen wir die
// einzelnen Increments als separate Events mit ihrem eigenen
// `amount`-Feld; CRUD-Events tragen nur den kumulativen value.
//
// **Aggregate-Stream:** ein Stream pro (tenant, capName) — siehe
// `rollingCapAggregateId`. Alle Increments hängen am selben Stream
// in monoton-steigender version. enforceRollingCap liest die letzten
// N Tage aus diesem Stream.

import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { rollingCapAggregateId } from "../aggregate-id";
import { CAP_COUNTER_ROLLING_AGGREGATE_TYPE, ROLLING_INCREMENTED_EVENT_QN } from "../constants";

const incrementRollingSchema = z.object({
  /** App-defined cap-name. e.g. "ai-tokens-7day", "egress-bytes-24h". */
  capName: z.string().min(1).max(100),
  /** Increment-amount. Default 1 (count-events) — pass exact size for
   *  byte/token-counters. Stored verbatim in the event payload so the
   *  Window-Sum is exact. */
  amount: z.number().int().positive().default(1),
});
type IncrementRollingPayload = z.infer<typeof incrementRollingSchema>;

/** Schema des emittierten Custom-Events. Identisch zum Input-Schema:
 *  der Caller zahlt amount, wir hängen es 1:1 an den Stream. */
export const rollingIncrementedSchema = incrementRollingSchema;

// Rolling-Increment-Handler — append-only. Race-frei: zwei parallele
// Increments für (tenant, cap) hängen sich am selben aggregate-stream
// in unterschiedlichen versions auf, das event-store ordert.
//
// **Kein version_conflict-Pfad** wie beim Calendar-Counter: hier
// liest niemand den projection-state vor dem Schreiben. Der
// expectedVersion ist implizit "next-after-current", was der event-
// store atomar ermittelt.
export const incrementRollingCapHandler: WriteHandlerDef = {
  name: "increment-rolling",
  schema: incrementRollingSchema,
  // Internal handler — System-Caller (Plattform-foundations nach
  // erfolgreichem Side-Effect) ruft das auf. Tenant-end-users niemals
  // direkt. Audit-row zeigt welche subsystem-call-site zugehängt hat.
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher hands handler the
    // already-Zod-validated payload as `unknown`; cast to the typed
    // shape we declared via incrementRollingSchema. Mirror der
    // existing increment.write.ts-Cast — gleiche dispatcher-boundary.
    const payload = event.payload as IncrementRollingPayload;
    const aggregateId = rollingCapAggregateId(event.user.tenantId, payload.capName);

    // appendEventUnsafe — bundled-features-Pfad (apps mit yarn kumiko
    // codegen kriegen den strict-typed appendEvent-Wrapper). Schema-
    // Validation läuft trotzdem, weil r.defineEvent das Schema
    // registriert hat.
    await ctx.appendEventUnsafe({
      aggregateId,
      aggregateType: CAP_COUNTER_ROLLING_AGGREGATE_TYPE,
      type: ROLLING_INCREMENTED_EVENT_QN,
      payload: {
        capName: payload.capName,
        amount: payload.amount,
      },
    });

    return { isSuccess: true, data: { aggregateId, amount: payload.amount } };
  },
};
