import {
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFileProviderForTenant } from "../file-foundation";
import { cancelDeletionWrite } from "./handlers/cancel-deletion.write";
import { exportStatusQuery } from "./handlers/export-status.query";
import { requestDeletionWrite } from "./handlers/request-deletion.write";
import { requestExportWrite } from "./handlers/request-export.write";
import { runForgetCleanupWrite } from "./handlers/run-forget-cleanup.write";
import { runExportJobs } from "./run-export-jobs";
import { exportDownloadTokenEntity } from "./schema/download-token";
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
    // file-foundation ist soft-dep: nur der Export-Worker (Atom 3b)
    // braucht ihn fuer Storage-Schreiben. Apps die nur Forget nutzen
    // (kein Export) muessen file-foundation nicht mounten — Worker
    // wirft zur Runtime einen klaren Error wenn der Provider fehlt.

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

    // S2.U3 Atom 4a — Download-Token-Entity. Worker generiert Token beim
    // Flip auf done (siehe run-export-jobs.ts). Hash in DB, plain im
    // RunExportJobsResult fuer Atom 5 (Notification per Email).
    // Atom 4b's Download-Endpoint verifiziert hash + streamt ZIP.
    r.entity("export-download-token", exportDownloadTokenEntity);

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

    // S2.U3 Atom 2 — User-Touchpoints fuer Async Export-Pipeline:
    //   POST /api/user/request-export   — Job-Trigger mit App-side-Pre-
    //                                     Check + crud.create (ES-Pattern)
    //   GET  /api/user/export-status    — Polling fuer den meist-aktuellen
    //                                     Job des Users
    //
    // Worker (Atom 3b), Download-Endpoint (Atom 4b) folgen.
    r.writeHandler(requestExportWrite);
    r.queryHandler(exportStatusQuery);
    r.exposesApi("userDataRights.runExport");

    // S2.U3 Atom 3b — Worker fuer Async Export-Pipeline. Cron-getriggert
    // (default 1× pro Minute; App-Author kann via config-key haerter
    // setzen). 3 Passes pro Run: stale-detection, pending-pickup, storage-
    // cleanup. concurrency:"skip" verhindert Cron-Overlap (Pass-internal
    // sequenziell wegen ZIP-Memory-Footprint pro Job).
    r.job(
      "run-export-jobs",
      { trigger: { cron: "0 * * * * *" }, concurrency: "skip" },
      async (_payload, ctx) => {
        if (!ctx.db || !ctx.registry) {
          throw new Error(
            "run-export-jobs: ctx.db + ctx.registry required (JobContext incomplete)",
          );
        }
        const T = (await import("@cosmicdrift/kumiko-framework/time")).getTemporal();
        // FileProviderContext explizit zusammenstellen — ctx ist AppContext,
        // hat config/registry/secrets, aber _userId ist im Job-Pfad nicht
        // automatisch gesetzt (dispatcher setzt es nur im request-Pfad).
        // Audit-Identity fuer Provider-Plugins die secrets lesen (z.B. S3):
        // SYSTEM_USER_ID ist die framework-weite Konvention. Der job-
        // Discriminator wird via handlerName="user-data-rights:run-export-
        // jobs" im Secret-Read-Audit erfasst (siehe createFileProviderForTenant-
        // Aufruf unten + secrets/feature.ts:requireSecretsContext).
        const providerCtx = {
          config: ctx.config,
          registry: ctx.registry,
          secrets: ctx.secrets,
          _userId: ctx._userId ?? SYSTEM_USER_ID,
        };
        await runExportJobs({
          // ctx.db ist DbConnection|TenantDb in AppContext-Type; im Job-
          // Pfad ist es die rohe Connection. Cast zu DbConnection legitim
          // weil JobContext-Wiring die rohe Connection liefert.
          db: ctx.db as import("@cosmicdrift/kumiko-framework/db").DbConnection,
          registry: ctx.registry,
          buildStorageProvider: async (tenantId) =>
            createFileProviderForTenant(providerCtx, tenantId, "user-data-rights:run-export-jobs"),
          now: T.Now.instant(),
        });
      },
    );
  });
}
