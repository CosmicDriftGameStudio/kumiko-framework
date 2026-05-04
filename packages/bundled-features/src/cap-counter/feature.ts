// cap-counter — Counter-Storage + Increment-API + Soft-Warn-State.
//
// **Was diese Feature liefert:**
//   1. r.entity("cap-counter") — Counter-Rows pro (tenant, capName,
//      period) für Calendar-Period-Caps (Mails/Monat, Egress/Monat).
//   2. increment-Handler — atomic counter increment via deterministic
//      aggregate-id (try-create / executor-update). Race-frei via
//      event-store optimistic-lock.
//   3. increment-rolling-Handler (Sprint 4) — append-only Custom-Event-
//      Stream für Rolling-Window-Caps (KI-Tokens-7d, Egress-24h). Kein
//      projection — der Wert kommt im Read aus dem Event-Stream.
//   4. mark-soft-warned-Handler — flippt das Anti-Notification-Storm-
//      Flag (nur Calendar-Period-Counter).
//   5. get-counter-Query — sync read der aktuellen Counter-Value
//      (Calendar).
//   6. enforceCap + enforceRollingCap-Helper (siehe enforce-cap.ts) —
//      Pre-Save-Wrapper mit asymmetrischen Soft/Hard-Toleranzen pro
//      Cap-Profile.
//
// **Calendar vs. Rolling — wann welches:**
//   - **Calendar-Period** (incrementCap + enforceCap): Cap resettet
//     sich am Period-Start (1. des Monats etc.). Counter ist 1 Row in
//     der projection. Schneller Read.
//   - **Rolling-Window** (incrementRollingCap + enforceRollingCap):
//     Cap rollt kontinuierlich (z.B. "letzten 7 Tage"). Werte
//     verfallen Event-für-Event ohne Reset. Kein projection — Read
//     summiert über die letzten N Tage Events.
//
// **Was diese Feature NICHT macht:**
//   - **Kein Foundation-Wiring.** mail-foundation / file-foundation /
//     ai-foundation sind heute BYOK-default und haben keinen Plattform-
//     Pool zum Zählen. Cap-Counter ist generic — wenn ein App-Owner
//     den Counter nutzen will, ruft er `incrementCap(...)` /
//     `incrementRollingCap(...)` aus seinem eigenen Handler auf.
//   - **Kein Reset-Cron für Calendar-Period.** Funktioniert ohne —
//     der periodStartIso-Bestandteil der aggregate-id rollt am
//     Period-Tick natürlich auf einen frischen Counter. Alte Rows
//     bleiben für Audit liegen.
//   - **Kein Notification-Pfad als Hard-Wiring.** Cap-counter
//     entkoppelt — `enforceCapAndMaybeNotify` (siehe enforce-cap.ts)
//     ist ein Convenience-Helper, der einen Caller-supplied
//     emit-Callback ausführt; cap-counter kennt delivery-feature
//     nicht direkt.
//
// **Boot-Dependencies:** keine. cap-counter ist Plain-Vanilla — kein
// config, kein secrets, kein tenant-feature nötig. Tenant-Scoping kommt
// vom Framework-Default (Base-Column tenantId).

import {
  defineEntityListHandler,
  defineFeature,
  type FeatureDefinition,
} from "@kumiko/framework/engine";
import { CAP_COUNTER_FEATURE, ROLLING_INCREMENTED_EVENT_SHORT } from "./constants";
import { capCounterEntity } from "./entity";
import { getCounterQuery } from "./handlers/get-counter.query";
import { incrementCapHandler } from "./handlers/increment.write";
import {
  incrementRollingCapHandler,
  rollingIncrementedSchema,
} from "./handlers/increment-rolling.write";
import { markSoftWarnedHandler } from "./handlers/mark-soft-warned.write";

const sysadminAccess = { access: { roles: ["SystemAdmin"] } } as const;

export const capCounterFeature: FeatureDefinition = defineFeature(CAP_COUNTER_FEATURE, (r) => {
  r.entity("cap-counter", capCounterEntity);

  // Custom Domain-Event für Rolling-Counter. r.defineEvent registriert
  // das Schema beim Registry; ctx.appendEventUnsafe im Handler nutzt
  // dasselbe Schema für Append-Time-Validation. QN nach Prefixing:
  // "cap-counter:event:rolling-incremented" (siehe
  // ROLLING_INCREMENTED_EVENT_QN).
  r.defineEvent(ROLLING_INCREMENTED_EVENT_SHORT, rollingIncrementedSchema);

  // Custom write-handlers.
  // - increment: Calendar-Period (CRUD via projection-row).
  // - increment-rolling: Rolling-Window (Custom-Event, no projection).
  // - mark-soft-warned: Anti-Notification-Storm-Flag (nur Calendar).
  r.writeHandler(incrementCapHandler);
  r.writeHandler(incrementRollingCapHandler);
  r.writeHandler(markSoftWarnedHandler);

  // Custom + standard reads. Sysadmin-cross-tenant via list, per-tenant
  // single-row via get-counter. Detail-by-id-handler bewusst weggelassen
  // (kein Use-Case; der natürliche Lookup ist über capName + period, nicht
  // über aggregate-id).
  r.queryHandler(defineEntityListHandler("cap-counter", capCounterEntity, sysadminAccess));
  r.queryHandler(getCounterQuery);
});
