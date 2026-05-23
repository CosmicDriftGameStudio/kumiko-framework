// POST /api/user/request-export (S2.U3 Atom 2) — DSGVO Art. 15 + 20 Trigger.
//
// User triggert Export-Job. Persistenz via createEventStoreExecutor
// (ES-Pattern, Memory: ES kein CRUD). Idempotency-Strategie zweistufig:
//
//   1) **App-side-Pre-Check (primaerer Pfad):** fetchOne aktive Jobs
//      (status pending|running) fuer den userId. Wenn existing,
//      return `{jobId, isExisting: true}` — KEIN neues Event,
//      sauberer Audit-Trail (1 Klick-Storm = 1 Event, nicht N).
//
//   2) **DB-Constraint als Race-Schutz (Sekundaerpfad):** Bei parallelem
//      Klick zwischen fetchOne + crud.create wirft die Tx 23505 mit
//      constraint_name === "read_export_jobs_one_active_per_user".
//      Catch + re-fetch + return existing als isExisting=true. Race-
//      Window <1ms, in Production extrem selten.
//
// **Cross-Tenant-Semantik:** ExportJob ist tenant-agnostisch (1 Job pro
// userId ueber alle Memberships). Pre-Check nutzt ctx.db.raw (kein
// TenantDb-Filter) — Alice klickt aus Tenant A, klickt dann aus Tenant
// B → Pre-Check aus B findet den A-Job, kein 2. Job entsteht.
// `requestedFromTenantId` persistiert den Initial-Tenant aus dem
// 1. Klick — Worker liest sein Compliance-Profile aus DIESEM Tenant
// fuer Job-TTL/Stale/Cleanup.

import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteFailure } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { z } from "zod";
import {
  ACTIVE_JOB_CONSTRAINT,
  EXPORT_JOB_STATUS,
  exportJobEntity,
  exportJobsTable,
} from "../schema/export-job";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";

const crud = createEventStoreExecutor(exportJobsTable, exportJobEntity, {
  entityName: "export-job",
});

/**
 * Race-Loss-Detection: createEventStoreExecutor.create catched 23505
 * intern + returnt `WriteFailure(UniqueViolationError)`, **kein throw**.
 * Wir checken den Failure-Code + constraintName um den App-side-vs-Race-
 * Pfad zu unterscheiden. Andere Failures (validation, version-conflict,
 * ...) propagieren unveraendert.
 */
function isActiveJobConflict(failure: WriteFailure): boolean {
  const error = failure.error as {
    code?: string;
    details?: { constraintName?: string };
  }; // @cast-boundary error-details
  return (
    error.code === "unique_violation" && error.details?.constraintName === ACTIVE_JOB_CONSTRAINT
  );
}

export const requestExportWrite = defineWriteHandler({
  name: "request-export",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const userId = event.user.id;
    const T = getTemporal();
    const now = T.Now.instant();

    // Pre-Check: ctx.db.raw weil ExportJob tenant-agnostisch ist —
    // der TenantDb-Wrapper wuerde Cross-Tenant-Jobs ausblenden.
    const existing = await findActiveJob(ctx.db.raw, userId);
    if (existing) {
      // Snapshot-Status (kann zwischen fetchOne + Response stale werden
      // wenn Worker parallel den State flippt; window minimal). User
      // pollt fuer Live-Wahrheit ueber export-status.query.
      return {
        isSuccess: true as const,
        data: {
          jobId: existing.id,
          status: existing.status,
          isExisting: true,
        },
      };
    }

    // Kein active Job — neuen anlegen via crud.create. requestedFromTenantId
    // = aktueller Tenant des Users; Worker liest sein Compliance-Profile
    // aus diesem Tenant.
    const result = await crud.create(
      {
        userId,
        requestedFromTenantId: event.user.tenantId,
        requestedAt: now,
        tenantId: event.user.tenantId,
      },
      event.user,
      ctx.db,
    );

    if (!result.isSuccess) {
      // Race-Pfad: paralleler Klick hat zwischen findActiveJob + crud.create
      // einen aktiven Job angelegt → UniqueViolationError mit unserem
      // Constraint. Re-fetch + return existing als isExisting=true.
      // Andere Failures (validation, version-conflict, ...) propagieren.
      if (isActiveJobConflict(result)) {
        const winner = await findActiveJob(ctx.db.raw, userId);
        if (!winner) {
          // Sollte nie passieren — Constraint-Violation ohne existing
          // active Job hiesse der Constraint matcht etwas anderes.
          // Original-Failure zurueckgeben damit das auffaellt.
          return result;
        }
        return {
          isSuccess: true as const,
          data: {
            jobId: winner.id,
            status: winner.status,
            isExisting: true,
          },
        };
      }
      return result;
    }

    // Happy path: neuer Job. SaveContext.id ist EntityId (number | string);
    // exportJobEntity hat idType:"uuid" → garantiert string, String()
    // schuetzt vor Drift falls jemand die Entity auf serial migriert.
    const created = result.data as SaveContext; // @cast-boundary engine-payload
    return {
      isSuccess: true as const,
      data: {
        jobId: String(created.id),
        // Snapshot: just-created → pending. Live-Wahrheit kommt ueber
        // export-status.query, status hier ist nice-to-have fuer das
        // initial UI-Render ("Anfrage angenommen, currently pending").
        status: EXPORT_JOB_STATUS.Pending,
        isExisting: false,
      },
    };
  },
});

async function findActiveJob(
  db: import("@cosmicdrift/kumiko-framework/db").DbRunner,
  userId: string,
): Promise<{ id: string; status: string } | null> {
  const row = await fetchOne<{ id: string; status: string }>(db, exportJobsTable, {
    userId,
    status: [EXPORT_JOB_STATUS.Pending, EXPORT_JOB_STATUS.Running],
  });
  return row ?? null;
}
