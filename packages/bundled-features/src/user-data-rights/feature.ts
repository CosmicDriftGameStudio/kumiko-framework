import {
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { cancelDeletionWrite } from "./handlers/cancel-deletion.write";
import { requestDeletionWrite } from "./handlers/request-deletion.write";
import { runForgetCleanupWrite } from "./handlers/run-forget-cleanup.write";
import { exportJobEntity } from "./schema/export-job";

// user-data-rights — DSGVO Art. 15 (Auskunft) + Art. 17 (Löschung) +
// Art. 18 (Restriction) + Art. 20 (Portabilität) als Core-Feature.
//
// Pattern (Plan-Roadmap docs/plans/datenschutz/user-data-rights.md):
// Statt jedes Feature seine eigene Forget-/Export-Logik schreibt,
// haengt es sich via `r.useExtension(EXT_USER_DATA, "<entity>", {
// export, delete })` an. user-data-rights orchestriert:
//   - Export-Job: iteriert alle Extension-Registrierungen, sammelt JSON
//   - Forget-Job: iteriert alle, ruft delete-Hook mit Strategy aus
//                 retention.policyFor (data-retention)
//   - Restriction: status-Flip auf user-Schema, Auth-Middleware-Guard
//
// Sprint 2.U2 (this commit): Feature scaffold + EXT_USER_DATA-Extension-
// Marker via r.extendsRegistrar. Andere features in Sprint 2.H1+H2
// haengen sich via useExtension an.
//
// Sprint 2.U3+U4: Async-Export-Job + Endpoints
// Sprint 2.U5: Forget-Pfad mit Grace + Cron-Cleanup
// Sprint 2.U6: Restriction (Art. 18) + Auth-Middleware-Guard
// Sprint 2.U7: audit-log + data-summary Queries
//
// Cross-Feature-API:
//   r.exposesApi("userDataRights.runForget") — Sprint 2.U5
//   r.exposesApi("userDataRights.runExport") — Sprint 2.U3
//
// Cross-Feature-Reads:
//   r.usesApi("compliance.forTenant")  — Forget-Grace aus Profile
//   r.usesApi("retention.policyFor")    — blockDelete-Konsultation
export function createUserDataRightsFeature(): FeatureDefinition {
  return defineFeature("user-data-rights", (r) => {
    r.requires("user", "data-retention", "compliance-profiles");
    r.usesApi("compliance.forTenant");
    r.usesApi("retention.policyFor");

    // EXT_USER_DATA — Schema-Marker fuer userData-Hooks. Andere features
    // (Sprint 2.H1+H2) registrieren via:
    //   r.useExtension(EXT_USER_DATA, "<entity>", { export, delete })
    //
    // Hooks-Signatur: framework/src/engine/extensions/user-data.ts
    // (UserDataExtensionHooks-Type aus S1.9 Z1).
    //
    // Boot-Validation der Hook-Shape kommt in S2.U3 wenn der Export-Runner
    // die Hooks zur Laufzeit ruft — dann faengt boot-validator falsch
    // typed Hooks frueh ab.
    r.extendsRegistrar(EXT_USER_DATA, {});

    // S2.U3+U4 Atom 1 — ExportJob-Lifecycle-Entity. Foundation fuer den
    // Async-Export-Pipeline. Worker (Atom 3) laeuft pro pending-Row durch
    // `runUserExport` + ZIP-Build, setzt status=done + downloadStorageKey.
    // Spec: docs/plans/architecture/user-data-rights.md "Async Export-Pipeline".
    r.entity("export-job", exportJobEntity);

    // S2.U5a — Endpoints fuer DSGVO Art. 17 Forget-Pfad mit Grace.
    //   POST /api/user/request-deletion — status-Flip "active" →
    //                                     "deletionRequested" + gracePeriodEnd
    //   POST /api/user/cancel-deletion  — Reversal innerhalb der Grace-Period
    r.writeHandler(requestDeletionWrite);
    r.writeHandler(cancelDeletionWrite);

    // S2.U5b — Cleanup-Runner als privileged-Handler. Cron triggert das
    // mit createSystemUser(...) als executor.
    r.writeHandler(runForgetCleanupWrite);
    r.exposesApi("userDataRights.runForget");

    // S2.U3+U4 (geplant) — Async Export-Pipeline:
    //   ExportJob-Entity (pending → running → done | failed)
    //   user-data-rights:write:request-export    (User triggert Job)
    //   user-data-rights:query:export-status     (User pollt Status)
    //   user-data-rights:query:download-export   (Job=done → Download)
    //   r.job("run-export-jobs", { trigger: { manual + cron } }) Worker
    //
    // `runUserExport` (siehe run-user-export.ts) ist die pure Single-User-
    // Bundle-Function — wird vom Worker pro Job-Row gerufen, nicht direkt
    // exposed. Plan-Doc:
    // docs/plans/architecture/user-data-rights.md "Async Export-Pipeline".
  });
}
