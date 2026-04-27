// applyEntityEvent — die EINZIGE Schreib-Logik für r.entity-Tabellen aus
// Stored-Events. Beide Aufrufer benutzen sie:
//
//   - createEventStoreExecutor (live, im Write-TX) — übergibt ein
//     "live event" mit unstripped flatData/flatChanges als payload damit
//     sensitive Felder in der Read-Tabelle landen, das Event-Log selbst
//     bleibt aber stripped (siehe append-Site im Executor).
//   - rebuildProjection via ImplicitProjection (replay, im Rebuild-TX) —
//     übergibt das StoredEvent direkt; payload ist dort ohne sensitive,
//     was bei Rebuild akzeptiert wird (sensitive-Drift durch GDPR-Strip
//     ist dokumentierte Roadmap-Lücke).
//
// Live==Rebuild-Equivalence ist damit by-construction für alle Felder
// die NICHT als sensitive markiert sind — eine geänderte Schreib-Logik
// muss nur an EINER Stelle gepflegt werden, kein Sync-Contract mehr.
// Der load-bearing Test bleibt für non-sensitive-Drift in
// db/__tests__/implicit-projection-equivalence.integration.ts.
//
// Tenant-Isolation: applyEntityEvent erwartet einen rohen DbRunner (TX
// oder pool), KEINEN TenantDb-Wrapper. Schutz kommt aus zwei Quellen:
//   1. Live-Pfad ruft VOR der Schreibung loadById (tenant-scoped) für
//      update/delete/restore — die aggregateId ist also schon tenant-
//      validiert bevor wir hier ankommen.
//   2. Bei create wird tenantId explizit aus event.tenantId gesetzt, also
//      nie über den TenantDb-Wrapper-Default abgeleitet.
// Damit ist der TenantDb-Wrapper-Loss in dieser Funktion funktional ohne
// Sicherheitslücke.
//
// Auto-Verben:
//   <entity>.created   → INSERT
//   <entity>.updated   → UPDATE WHERE id=aggregateId
//   <entity>.deleted   → soft-delete-UPDATE wenn entity.softDelete, sonst hard-DELETE
//   <entity>.restored  → undelete-UPDATE (nur bei softDelete sinnvoll)
//
// Domain-Events (r.defineEvent) auf demselben Aggregate werden hier NICHT
// behandelt — die liefen im Live-Pfad nie durch den Executor und müssen
// von expliziten r.projection-apply-Handlern oder r.multiStreamProjection
// behandelt werden. ImplicitProjection registriert daher nur die 4
// Auto-Verben.
//
// Return-Shape: ApplyResult mit `kind` + optionaler `row`.
//   - "applied" → Schreibung lief durch. `row` enthält die geschriebene
//     Row für create/update/soft-delete/restore. Bei hard-delete ist
//     `row` null (DELETE-Statements geben keine returning-Row her).
//   - "skipped" → Event ist kein Auto-Verb (Domain-Event auf demselben
//     Aggregate). Caller no-op.

import { eq } from "drizzle-orm";
import type { EntityDefinition } from "../engine/types";
import type { StoredEvent } from "../event-store";
import type { DbRow, DbRunner } from "./connection";
import type { TableColumns } from "./dialect";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle-Tabellen sind generisch typed; framework code erasiert die Spalten-Union absichtlich.
type Table = TableColumns<any>;

export type AutoVerb = "created" | "updated" | "deleted" | "restored";

export type ApplyResult =
  | { readonly kind: "applied"; readonly verb: AutoVerb; readonly row: DbRow | null }
  | { readonly kind: "skipped" };

/** Parsed event.type → AutoVerb wenn das Event eines der 4 Auto-Verben
 *  auf dem gegebenen Aggregate ist. null sonst (Domain-Event). */
export function parseAutoVerb(event: StoredEvent): AutoVerb | null {
  const prefix = `${event.aggregateType}.`;
  if (!event.type.startsWith(prefix)) return null;
  const verb = event.type.slice(prefix.length);
  if (verb === "created" || verb === "updated" || verb === "deleted" || verb === "restored") {
    return verb;
  }
  return null;
}

/** Idempotente Anwendung eines Auto-Events auf die Entity-Tabelle.
 *  Wird sowohl beim Live-Append (innerhalb der Write-TX) als auch beim
 *  Rebuild (innerhalb der Rebuild-TX) gerufen — identische Logik. */
export async function applyEntityEvent(
  event: StoredEvent,
  table: Table,
  entity: EntityDefinition,
  tx: DbRunner,
): Promise<ApplyResult> {
  const verb = parseAutoVerb(event);
  if (verb === null) return { kind: "skipped" };
  const softDelete = entity.softDelete ?? false;

  switch (verb) {
    case "created": {
      // event.payload-Defaults: TenantId-Auto-Inject im Live-Pfad fällt
      // weg (wir nutzen tx=db.raw), beim Replay gibt's keinen Wrapper.
      // Default = event.tenantId; payload überschreibt wenn explicit
      // gesetzt (z.B. seedTenantMembership schreibt mit by.tenantId !=
      // options.tenantId — die Membership-Row landet im Ziel-Tenant,
      // das Event im Operator-Tenant).
      const [row] = await tx
        .insert(table)
        .values({
          tenantId: event.tenantId,
          ...event.payload,
          id: event.aggregateId,
          version: event.version,
          insertedAt: event.createdAt,
          insertedById: event.createdBy,
        })
        .returning();
      return { kind: "applied", verb, row: (row as DbRow | undefined) ?? null };
    }

    case "updated": {
      // payload-Shape: { changes, previous } — siehe event-store-executor.ts.
      const changes = (event.payload["changes"] ?? {}) as Record<string, unknown>;
      const [row] = await tx
        .update(table)
        .set({
          ...changes,
          version: event.version,
          modifiedAt: event.createdAt,
          modifiedById: event.createdBy,
        })
        .where(eq(table["id"], event.aggregateId))
        .returning();
      return { kind: "applied", verb, row: (row as DbRow | undefined) ?? null };
    }

    case "deleted": {
      if (softDelete) {
        const [row] = await tx
          .update(table)
          .set({
            isDeleted: true,
            deletedAt: event.createdAt,
            deletedById: event.createdBy,
            version: event.version,
            modifiedAt: event.createdAt,
            modifiedById: event.createdBy,
          })
          .where(eq(table["id"], event.aggregateId))
          .returning();
        return { kind: "applied", verb, row: (row as DbRow | undefined) ?? null };
      }
      // Hard-Delete: DELETE-Statement gibt keine returning-Row her und
      // der Live-Pfad nutzt eh `existing` (pre-delete-Snapshot) für die
      // Response. Beim Replay ist das fine, der Caller braucht die Row
      // nicht weiter.
      await tx.delete(table).where(eq(table["id"], event.aggregateId));
      return { kind: "applied", verb, row: null };
    }

    case "restored": {
      // Restore ist nur bei softDelete sinnvoll. Hard-Delete-Entities sollten
      // keine restored-Events erhalten — falls doch, defensive skip.
      if (!softDelete) return { kind: "skipped" };
      const [row] = await tx
        .update(table)
        .set({
          isDeleted: false,
          deletedAt: null,
          deletedById: null,
          version: event.version,
          modifiedAt: event.createdAt,
          modifiedById: event.createdBy,
        })
        .where(eq(table["id"], event.aggregateId))
        .returning();
      return { kind: "applied", verb, row: (row as DbRow | undefined) ?? null };
    }
  }
}
