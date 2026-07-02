// User-Data-Export-Pipeline (S2.U3) — DSGVO Art. 15 (Auskunft) +
// Art. 20 (Datenportabilität).
//
// Pure Pipeline-Function: ruft alle EXT_USER_DATA-export-Hooks ueber
// alle Tenant-Memberships eines Users + sammelt das Ergebnis als
// strukturiertes Bundle.
//
// **Async ZIP + Storage (S2.U3-ext) bewusst spaeter:** Diese Foundation
// gibt das Bundle inline zurueck (JSON-Object). Apps mit grossen
// File-Mengen brauchen einen Job-Wrap der das Bundle nach S3 / lokalem
// Storage schreibt + signed-URLs ergibt — kommt drauf wenn ein realer
// User-Case >10MB Output produziert. Bis dahin reicht inline fuer
// 99% der Apps (User-Profil + Files-Metadata + Aktivitaeten-History).
//
// **Cross-Tenant-Iteration:** Wie beim Forget-Pfad — User-Daten in
// Tenant A + B kommen in dasselbe Bundle. Plan-Doc:
// docs/plans/architecture/user-data-rights.md "Cross-Tenant-Semantik".
//
// **PII-Surface:** Hooks definieren selbst welche Felder ins Bundle
// landen. user-data-rights-defaults/hooks/user.userdata-hook expose
// expliziert KEIN passwordHash + KEINE roles (privileged columns).

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  collectEncryptedFieldNames,
  configuredEntityFieldEncryption,
  decryptEntityFieldValues,
} from "@cosmicdrift/kumiko-framework/db";
import {
  EXT_USER_DATA,
  type Registry,
  type TenantId,
  type UserDataExportHook,
  type UserDataExportSnippet,
} from "@cosmicdrift/kumiko-framework/engine";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { tenantMembershipsTable } from "../tenant";
import { buildFileRefZipPath } from "./zip-path";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

export interface RunUserExportArgs {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly userId: string;
  readonly now: Instant;
}

export interface UserExportFileRef {
  readonly fileRefId: string;
  readonly storageKey: string;
  readonly fileName: string;
  /** Tenant in dem die Datei haengt — gleicher fileRefId kann nicht ueber Tenants geteilt sein. */
  readonly tenantId: TenantId;
  /**
   * ZIP-internal Pfad unter dem die Datei im Export-ZIP landet. Reader-
   * Tools (Compliance-Audit, Self-Service-Portal) verlinken bundle.json
   * fileRefs[] auf die files/-Pfade ueber dieses Feld. Garantiert
   * path-traversal-frei via sanitizeZipFilename.
   */
  readonly zipPath: string;
}

export interface UserExportTenantSection {
  readonly tenantId: TenantId;
  /** Pro Entity ein Snippet ({entity, rows[]}). Empty wenn Hook null returned. */
  readonly entities: ReadonlyArray<UserDataExportSnippet>;
}

export interface UserExportBundle {
  readonly userId: string;
  /** ISO-8601 Generation-Timestamp — fuer Audit-Trail. */
  readonly generatedAt: string;
  /** Pro Tenant in dem User Mitglied ist eine Section. Orphan-User → tenants=[]. */
  readonly tenants: ReadonlyArray<UserExportTenantSection>;
  /**
   * Flat-Liste aller fileRefs aus allen Tenant-Sections — der spaetere
   * ZIP-Bau-Job iteriert hier durch + zieht Binaries aus dem Storage-
   * Provider. Bis dahin ist das die Stueckliste fuer den Operator.
   */
  readonly fileRefs: ReadonlyArray<UserExportFileRef>;
}

interface HookEntry {
  readonly entityName: string;
  readonly exportHook: UserDataExportHook;
}

/**
 * Pure function: iteriert alle EXT_USER_DATA-Hooks pro Tenant (Cross-
 * Tenant-Memberships) + sammelt Snippets in ein UserExportBundle.
 *
 * **Memory-Footprint:**
 *
 * Der gesamte Storage-Pfad ist streaming-bound:
 *   - File-Binaries via provider.readStream → chunk-streaming, skaliert
 *     auf beliebige File-Sizes ohne Heap-Spike.
 *   - ZIP-Schreiben via provider.writeStream — local nutzt fs.createWriteStream,
 *     S3 nutzt lib-storage.Upload (multipart, ~20MB Heap-Bound bei 4
 *     concurrent parts).
 *
 * **EINZIGER nicht-streaming Pfad:** das Bundle-Object selbst (bundle.json
 * Inhalt). Es wird komplett in-memory gebaut bevor `bundleToZipEntries`
 * es als ZIP-Entry yieldet. Hooks geben Snippets als Plain-Objects
 * zurueck (siehe UserDataExportSnippet).
 *
 * **Threshold:** Web-App mit ~500 Tabellen-Rows pro User ≈ 500 KB JSON.
 * 50k Rows ≈ 50 MB. 100k+ Rows pro User (z.B. langjaehrige Mietportal-
 * Logs) macht Heap-Druck merkbar.
 *
 * **Wenn das knapp wird:** runUserExport auf AsyncIterable-Form refactoren —
 * Hooks yielden snippets statt Object-Returns; Bundle-Schema bekommt
 * JSON-Lines-Format. bundleToZipEntries wuerde line-by-line streamen.
 * Eigener Sprint, nicht-trivialer Schema-Bruch.
 *
 * **Operator-Signal:** wenn bundle.json im ZIP > 100 MB ist, sollte
 * Telemetry triggern + Schema-Refactor evaluieren.
 */
export async function runUserExport(args: RunUserExportArgs): Promise<UserExportBundle> {
  const { db, registry, userId, now } = args;

  // Memberships → Tenant-Liste fuer Hook-Iteration.
  const memberships = await selectMany<{ tenantId: TenantId }>(db, tenantMembershipsTable, {
    userId,
  });

  const tenantList: TenantId[] = memberships.map((m) => m.tenantId);

  // EXT_USER_DATA-Usages → export-Hook-Liste.
  const usages = registry.getExtensionUsages(EXT_USER_DATA);
  const hookEntries: HookEntry[] = usages
    .map((u): HookEntry | null => {
      const opts = (u.options ?? {}) as { export?: UserDataExportHook }; // @cast-boundary engine-payload
      return opts.export ? { entityName: u.entityName, exportHook: opts.export } : null;
    })
    .filter((x): x is HookEntry => x !== null);

  const tenants: UserExportTenantSection[] = [];
  const fileRefs: UserExportFileRef[] = [];

  for (const tenantId of tenantList) {
    const entities: UserDataExportSnippet[] = [];
    for (const entry of hookEntries) {
      const rawSnippet = await entry.exportHook({ db, registry, tenantId, userId });
      if (rawSnippet === null) continue;
      const snippet = await decryptSnippetFields(registry, entry.entityName, rawSnippet);
      entities.push(snippet);
      if (snippet.fileRefs) {
        for (const ref of snippet.fileRefs) {
          fileRefs.push({
            ...ref,
            tenantId,
            zipPath: buildFileRefZipPath({
              tenantId,
              fileRefId: ref.fileRefId,
              fileName: ref.fileName,
            }),
          });
        }
      }
    }
    tenants.push({ tenantId, entities });
  }

  // Edge-Case "0 Memberships": Tenant-agnostische Hooks (z.B. user-Hook)
  // wuerden bei Cross-Tenant-Iteration mehrfach laufen. Bei orphan-User
  // (kein Membership) wuerden sie gar nicht laufen. Loesung wie beim
  // Forget-Runner: einen Sonder-Lauf mit einem Pseudo-Tenant ergaenzen
  // damit die globale User-Row IM Bundle landet. Tenant-scoped Hooks
  // sind no-op.
  //
  // Das Pattern matched run-forget-cleanup.ts; Memory: Cross-Tenant-
  // Konsistenz darf nicht silent kippen wenn Memberships leer sind.
  if (tenantList.length === 0 && hookEntries.length > 0) {
    const orphanEntities: UserDataExportSnippet[] = [];
    for (const entry of hookEntries) {
      const rawSnippet = await entry.exportHook({
        db,
        registry,
        tenantId: SYSTEM_TENANT_ID_FOR_ORPHANS,
        userId,
      });
      if (rawSnippet === null) continue;
      const snippet = await decryptSnippetFields(registry, entry.entityName, rawSnippet);
      orphanEntities.push(snippet);
      if (snippet.fileRefs) {
        for (const ref of snippet.fileRefs) {
          fileRefs.push({
            ...ref,
            tenantId: SYSTEM_TENANT_ID_FOR_ORPHANS,
            zipPath: buildFileRefZipPath({
              tenantId: SYSTEM_TENANT_ID_FOR_ORPHANS,
              fileRefId: ref.fileRefId,
              fileName: ref.fileName,
            }),
          });
        }
      }
    }
    if (orphanEntities.length > 0) {
      tenants.push({ tenantId: SYSTEM_TENANT_ID_FOR_ORPHANS, entities: orphanEntities });
    }
  }

  return {
    userId,
    generatedAt: now.toString(),
    tenants,
    fileRefs,
  };
}

// Art. 20 verlangt die DATEN, nicht deren Ciphertext: Export-Hooks lesen
// raw rows an der Executor-Decrypt-Schicht vorbei, darum entschluesselt
// dieser zentrale Pass encrypted entity fields nach jedem Hook. Ohne
// konfigurierten Cipher wird ein expliziter Marker exportiert statt den
// base64-Blob als "Wert" auszuliefern (leak-by-confusion).
const ENCRYPTED_UNAVAILABLE = "[encrypted:unavailable]";

async function decryptSnippetFields(
  registry: Registry,
  hookEntityName: string,
  snippet: UserDataExportSnippet,
): Promise<UserDataExportSnippet> {
  const entity = registry.getEntity(snippet.entity) ?? registry.getEntity(hookEntityName);
  if (!entity) return snippet;
  const encryptedFields = collectEncryptedFieldNames(entity);
  if (encryptedFields.size === 0) return snippet;

  const cipher = configuredEntityFieldEncryption();
  const rows = await Promise.all(
    snippet.rows.map(async (row) => {
      if (cipher) return decryptEntityFieldValues(row, encryptedFields, cipher);
      const out = { ...row };
      for (const name of encryptedFields) {
        if (typeof out[name] === "string") out[name] = ENCRYPTED_UNAVAILABLE;
      }
      return out;
    }),
  );
  return { ...snippet, rows };
}

// Pseudo-Tenant fuer User ohne aktive Memberships. Identisch zum
// Pattern in run-forget-cleanup.ts — RFC4122-Null-UUID. Tenant-scoped
// Hooks finden hier nichts (no-op).
const SYSTEM_TENANT_ID_FOR_ORPHANS = "00000000-0000-0000-0000-000000000000" as TenantId;
