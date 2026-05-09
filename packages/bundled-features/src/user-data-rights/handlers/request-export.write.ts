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

import { createEventStoreExecutor, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "../schema/export-job";

const crud = createEventStoreExecutor(exportJobsTable, exportJobEntity, {
  entityName: "export-job",
});

// Constraint-Name aus dem Partial-UNIQUE-Index. Magic-String hier akzeptabel
// weil Schema-Drift-Test (export-job-idempotency.integration.ts) den
// Namen pinst — ein Rename faellt im Test um.
const IDEMPOTENCY_CONSTRAINT = "read_export_jobs_one_active_per_user";

// PG-sqlstate fuer unique_violation.
const PG_UNIQUE_VIOLATION = "23505";

function isIdempotencyRaceLoss(e: unknown): boolean {
  const cause = (e as { cause?: { code?: string; constraint_name?: string } }).cause;
  return cause?.code === PG_UNIQUE_VIOLATION && cause.constraint_name === IDEMPOTENCY_CONSTRAINT;
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
    try {
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
      if (!result.isSuccess) return result;
      const created = result.data as { id: string };
      return {
        isSuccess: true as const,
        data: {
          jobId: created.id,
          status: EXPORT_JOB_STATUS.Pending,
          isExisting: false,
        },
      };
    } catch (e) {
      // Race verloren: paralleler Klick hat zwischen fetchOne + create
      // einen aktiven Job angelegt. Re-fetch + return als isExisting.
      // Andere Errors (DB-Down, Schema-Bug, ...) werfen wir weiter.
      if (!isIdempotencyRaceLoss(e)) throw e;
      const winner = await findActiveJob(ctx.db.raw, userId);
      if (!winner) {
        // Sollte nie passieren — Constraint-Violation OHNE existing
        // active job hieße der Constraint matcht etwas anderes als wir
        // denken. Werfen damit das auffaellt.
        throw e;
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
  },
});

async function findActiveJob(
  db: import("@cosmicdrift/kumiko-framework/db").DbRunner,
  userId: string,
): Promise<{ id: string; status: string } | null> {
  // @cast-boundary db-row — fetchOne liefert generic DbRow.
  // Variadic-conditions werden intern mit AND verknuepft.
  const row = (await fetchOne(
    db,
    exportJobsTable,
    eq(exportJobsTable["userId"], userId),
    inArray(exportJobsTable["status"], [EXPORT_JOB_STATUS.Pending, EXPORT_JOB_STATUS.Running]),
  )) as { id: string; status: string } | null;
  return row;
}
