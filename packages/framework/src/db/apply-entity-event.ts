// applyEntityEvent — die Schreib-Logik für r.entity-Tabellen aus
// Stored-Events. Wird beim Rebuild über die ImplicitProjection gerufen
// (registry.ts:buildImplicitProjection).
//
// !!! WICHTIG — Sync-Contract mit EventStoreExecutor !!!
//
// Der Live-Pfad (createEventStoreExecutor) macht heute STRUKTUR-IDENTISCHE
// inline-Schreibungen statt diese Funktion zu rufen (für die
// `returning()`-Row die der Response-Builder braucht). Das heißt: jede
// Änderung an der Schreib-Logik MUSS in BEIDE Stellen gehen, sonst
// driften Live + Rebuild auseinander.
//
// Load-bearing test: db/__tests__/implicit-projection-equivalence.
// integration.ts. Wenn dieser Test failed nach einer Änderung am
// EventStoreExecutor oder hier — die Drift ist da, fix vor Commit.
//
// Roadmap (eigenes Sprint, nicht jetzt): EventStoreExecutor refactoren
// um applyEntityEvent direkt zu nutzen + die Row separat per SELECT zu
// holen. Dann ist Live==Rebuild by-construction statt by-test.
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

import { eq } from "drizzle-orm";
import type { EntityDefinition } from "../engine/types";
import type { StoredEvent } from "../event-store";
import type { DbRunner } from "./connection";
import type { TableColumns } from "./dialect";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle-Tabellen sind generisch typed; framework code erasiert die Spalten-Union absichtlich.
type Table = TableColumns<any>;

export type AutoVerb = "created" | "updated" | "deleted" | "restored";

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
 *  Rebuild (innerhalb der Rebuild-TX) gerufen — identische Logik.
 *
 *  Returns true wenn was geschrieben wurde (für Live-Pfad relevant
 *  damit der Caller die `returning()`-Row weiterverarbeiten kann),
 *  false wenn das Event-Type kein Auto-Verb war (no-op). */
export async function applyEntityEvent(
  event: StoredEvent,
  table: Table,
  entity: EntityDefinition,
  tx: DbRunner,
): Promise<boolean> {
  const verb = parseAutoVerb(event);
  if (verb === null) return false;
  const softDelete = entity.softDelete ?? false;

  switch (verb) {
    case "created": {
      // event.payload ist bereits stripSensitive + flat (siehe append-Site
      // in event-store-executor.ts:322). tenantId ist im Live-Pfad vom
      // TenantDb-Wrapper auto-injected — beim Replay läuft das raw `tx`
      // ohne Wrapper, also setzen wir explizit aus event.tenantId.
      await tx.insert(table).values({
        ...event.payload,
        id: event.aggregateId,
        tenantId: event.tenantId,
        version: event.version,
        insertedAt: event.createdAt,
        insertedById: event.createdBy,
      });
      return true;
    }

    case "updated": {
      // payload-Shape: { changes, previous } — siehe event-store-executor.ts:456.
      const changes = (event.payload["changes"] ?? {}) as Record<string, unknown>;
      await tx
        .update(table)
        .set({
          ...changes,
          version: event.version,
          modifiedAt: event.createdAt,
          modifiedById: event.createdBy,
        })
        .where(eq(table["id"], event.aggregateId));
      return true;
    }

    case "deleted": {
      if (softDelete) {
        await tx
          .update(table)
          .set({
            isDeleted: true,
            deletedAt: event.createdAt,
            deletedById: event.createdBy,
            version: event.version,
            modifiedAt: event.createdAt,
            modifiedById: event.createdBy,
          })
          .where(eq(table["id"], event.aggregateId));
      } else {
        await tx.delete(table).where(eq(table["id"], event.aggregateId));
      }
      return true;
    }

    case "restored": {
      // Restore ist nur bei softDelete sinnvoll. Hard-Delete-Entities sollten
      // keine restored-Events erhalten — falls doch, no-op (defensive).
      if (!softDelete) return false;
      await tx
        .update(table)
        .set({
          isDeleted: false,
          deletedAt: null,
          deletedById: null,
          version: event.version,
          modifiedAt: event.createdAt,
          modifiedById: event.createdBy,
        })
        .where(eq(table["id"], event.aggregateId));
      return true;
    }
  }
}
