// cap-counter — Counter-Storage + Increment-API + Soft-Warn-State.
//
// **Was diese Feature liefert:**
//   1. r.entity("cap-counter") — Counter-Rows pro (tenant, capName, period)
//   2. increment-Handler — atomic counter increment via deterministic
//      aggregate-id (try-create / executor-update). Race-frei via
//      event-store optimistic-lock.
//   3. mark-soft-warned-Handler — flippt das Anti-Notification-Storm-Flag.
//   4. get-counter-Query — sync read der aktuellen Counter-Value.
//   5. enforceCap-Helper (siehe enforce-cap.ts) — Pre-Save-Wrapper mit
//      asymmetrischen Soft/Hard-Toleranzen pro Cap-Profile.
//
// **Was diese Feature NICHT macht:**
//   - **Kein Foundation-Wiring.** mail-foundation / file-foundation /
//     ai-foundation sind heute BYOK-default und haben keinen Plattform-
//     Pool zum Zählen. Cap-Counter ist generic — wenn ein App-Owner
//     den Counter nutzen will, ruft er `incrementCap(...)` aus seinem
//     eigenen Handler auf. Sprint 4 (Add-Ons) oder ein konkreter
//     Pilot-Bedarf wirft die Foundation-Hooks an.
//   - **Kein Reset-Cron.** Der Caller-App ruft ein Job (BullMQ via
//     bundled-features/jobs) mit dem incrementCap-Handler bei
//     periodischem Reset (= neuer periodStart). Das gehört in die
//     Plattform-App, nicht in das Foundation-Feature.
//   - **Kein Notification-Pfad.** Soft-Hit emittiert KEIN Event direkt;
//     der Caller (enforceCap) bekommt `{state: "soft-hit", crossed: true}`
//     zurück und entscheidet selbst (delivery-feature, ops-alert,
//     dashboard-warning). Die Engine bleibt entkoppelt.
//
// **Boot-Dependencies:** keine. cap-counter ist Plain-Vanilla — kein
// config, kein secrets, kein tenant-feature nötig. Tenant-Scoping kommt
// vom Framework-Default (Base-Column tenantId).

import {
  defineEntityListHandler,
  defineFeature,
  type FeatureDefinition,
} from "@kumiko/framework/engine";
import { CAP_COUNTER_FEATURE } from "./constants";
import { capCounterEntity } from "./entity";
import { getCounterQuery } from "./handlers/get-counter.query";
import { incrementCapHandler } from "./handlers/increment.write";
import { markSoftWarnedHandler } from "./handlers/mark-soft-warned.write";

const sysadminAccess = { access: { roles: ["SystemAdmin"] } } as const;

export const capCounterFeature: FeatureDefinition = defineFeature(CAP_COUNTER_FEATURE, (r) => {
  r.entity("cap-counter", capCounterEntity);

  // Custom write-handlers — increment uses deterministic aggregate-id;
  // mark-soft-warned only updates the lastSoftWarnedAt flag.
  r.writeHandler(incrementCapHandler);
  r.writeHandler(markSoftWarnedHandler);

  // Custom + standard reads. Sysadmin-cross-tenant via list, per-tenant
  // single-row via get-counter. Detail-by-id-handler bewusst weggelassen
  // (kein Use-Case; der natürliche Lookup ist über capName + period, nicht
  // über aggregate-id).
  r.queryHandler(defineEntityListHandler("cap-counter", capCounterEntity, sysadminAccess));
  r.queryHandler(getCounterQuery);
});
