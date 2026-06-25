// Retention-Cleanup-Runner (S2.D2b) — pure Function, vom retention-cleanup-Cron
// pro fan-out-Tenant aufgerufen.
//
// Iteriert alle implicit-Entity-Projektionen, loest pro Entity die effektive
// Retention-Policy (3-Schicht-Resolver, siehe resolver.ts) und wendet die
// Strategy auf Rows an deren reference-Timestamp aelter als der keepFor-Cutoff
// ist:
//
//   - hardDelete  → deleteManyBatched (selbst-begrenzt, kein Full-Table-Scan)
//   - softDelete  → isDeleted=true/deletedAt=now, nur auf noch-nicht-geloeschte
//   - anonymize   → DEFERRED (siehe unten)
//   - blockDelete → ignoriert (Aufbewahrungs-Pflicht; user-forget loest anonymize)
//
// **Schaerfer als soft-delete-cleanup:** dieser Cron hardDeleted LIVE Rows
// (keyed auf reference, Default createdAt), nicht bereits-soft-geloeschte.
// Darum die Spalten-Existenz-Pruefung vor jedem WHERE — eine fehlende/vertippte
// reference-Spalte wuerde sonst ein malformed/all-matching WHERE ergeben und
// pauschal loeschen.
//
// **anonymize deferred:** anonymize behaelt die Row. Ohne Idempotenz-Marker
// wuerde der taegliche UPDATE jede past-cutoff Row endlos neu treffen — genau
// der Full-Table-Scan den die Strategie vermeiden soll (hardDelete begrenzt
// sich selbst, softDelete via isDeleted:false). Kein bundled-Entity nutzt
// zeitgesteuertes anonymize; der user-forget-Flow (run-forget-cleanup) deckt
// anonymize keyed auf userId ab. Follow-up fuer den Marker.

import { deleteManyBatched, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner, WhereObject } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { computeCutoff, type Instant } from "./keep-for";
import type { RetentionPresetKey } from "./presets";
import { resolveRetentionPolicyForTenant } from "./resolve-for-tenant";

const DEFAULT_BATCH_LIMIT = 1000;
const DEFAULT_REFERENCE_FIELD = "createdAt";

// Der Boot-Validator (boot-validator/pii-retention.ts FRAMEWORK_TIMESTAMP_FIELDS)
// erlaubt diese Aliase als retention.reference, auch wenn sie nicht in
// entity.fields deklariert sind — die physischen Spalten heissen aber anders
// (table-builder.ts: inserted_at/modified_at). Hier zur Cleanup-Zeit auf das
// echte Entity-Feld mappen, sonst trifft die Spalten-Existenz-Pruefung unten
// und der Cron wuerde lautlos nichts tun. deletedAt/lastSeenAt sind echte
// Felder (softDelete bzw. session) und brauchen keine Uebersetzung.
const FRAMEWORK_REFERENCE_ALIAS: Readonly<Record<string, string>> = {
  createdAt: "insertedAt",
  updatedAt: "modifiedAt",
};

export interface RunRetentionCleanupArgs {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  /** Layer-2 Preset (aus resolveTenantRetentionPreset). null = nur Layer 1/3. */
  readonly tenantPreset: RetentionPresetKey | null;
  /** Now-Injection — Tests pinnen den Wert ohne Date-Mock (Pattern keep-for.ts). */
  readonly now: Instant;
  readonly batchLimit?: number;
}

export interface RetentionCleanupSkip {
  readonly entityName: string;
  readonly reason: "missing_reference_column" | "missing_softdelete_columns";
}

export interface RunRetentionCleanupResult {
  readonly hardDeleted: number;
  readonly softDeleted: number;
  /** Entities mit anonymize-Strategy — deferred (Header). Cron logt sie. */
  readonly anonymizeDeferred: readonly string[];
  /** Anomalien: Policy referenziert eine Spalte die die Tabelle nicht hat. */
  readonly skipped: readonly RetentionCleanupSkip[];
}

export async function runRetentionCleanup(
  args: RunRetentionCleanupArgs,
): Promise<RunRetentionCleanupResult> {
  const { db, registry, tenantId, tenantPreset, now } = args;
  const batchLimit = args.batchLimit ?? DEFAULT_BATCH_LIMIT;

  let hardDeleted = 0;
  let softDeleted = 0;
  const anonymizeDeferred: string[] = [];
  const skipped: RetentionCleanupSkip[] = [];

  for (const proj of registry.getAllProjections().values()) {
    // Nur implicit-Entity-Projektionen mit Tabelle — wie soft-delete-cleanup.
    // Custom-Projektionen + unmanaged-Tables (z.B. sessions) sind kein Target.
    if (proj.isImplicit !== true || typeof proj.source !== "string" || !proj.table) continue;
    const entityName = proj.source;

    const resolved = await resolveRetentionPolicyForTenant({
      db,
      registry,
      tenantId,
      entityName,
      tenantPreset,
    });
    const policy = resolved.policy;
    if (!policy) continue;

    const table = proj.table as Record<string, unknown>; // @cast-boundary column-presence probe
    const declaredReference = policy.reference ?? DEFAULT_REFERENCE_FIELD;
    const referenceField = FRAMEWORK_REFERENCE_ALIAS[declaredReference] ?? declaredReference;

    if (table[referenceField] === undefined) {
      skipped.push({ entityName, reason: "missing_reference_column" });
      continue;
    }

    const cutoff = computeCutoff(policy.keepFor, now);
    const where: WhereObject = { [referenceField]: { lt: cutoff } };
    // Tenant-Scope nur wenn die Tabelle eine tenantId-Spalte hat — identisch zu
    // soft-delete-cleanup. Ohne diesen Filter wuerde ein Tenant die Rows eines
    // anderen treffen.
    if (table["tenantId"] !== undefined) {
      where["tenantId"] = tenantId;
    }

    switch (policy.strategy) {
      case "hardDelete": {
        const res = await deleteManyBatched(db, proj.table, where, { limit: batchLimit });
        hardDeleted += res.deleted;
        break;
      }
      case "softDelete": {
        if (table["isDeleted"] === undefined || table["deletedAt"] === undefined) {
          skipped.push({ entityName, reason: "missing_softdelete_columns" });
          break;
        }
        const updated = await updateMany(
          db,
          proj.table,
          { isDeleted: true, deletedAt: now },
          { ...where, isDeleted: false },
        );
        softDeleted += updated.length;
        break;
      }
      case "anonymize": {
        anonymizeDeferred.push(entityName);
        break;
      }
      case "blockDelete": {
        // skip: Aufbewahrungs-Pflicht — Cleanup ignoriert, user-forget anonymisiert
        break;
      }
    }
  }

  return { hardDeleted, softDeleted, anonymizeDeferred, skipped };
}
