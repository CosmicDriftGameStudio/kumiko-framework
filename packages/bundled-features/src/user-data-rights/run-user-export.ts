import { createFallbackLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging";
// User data export pipeline — GDPR Art. 15 (access) +
// Art. 20 (data portability).
//
// Pure pipeline function: invokes all EXT_USER_DATA export hooks for
// all of a user's tenant memberships and collects the results into a
// structured bundle.
//
// **Async ZIP + storage deferred:** This foundation returns the bundle
// inline as a JSON object. Apps with large file collections need a job
// wrapper that writes the bundle to S3 or local storage and produces
// signed URLs; that can be added when a real use case produces more than
// 10 MB of output. Until then, inline output covers 99% of apps
// (user profiles, file metadata, and activity history).
//
// **Cross-tenant iteration:** As with the forget path, data from Tenant A
// and Tenant B is included in the same bundle.
//
// **PII surface:** Hooks decide which fields enter the bundle.
// user-data-rights-defaults/hooks/user.userdata-hook explicitly exposes
// neither passwordHash nor roles (privileged columns).

import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  collectEncryptedFieldNames,
  configuredEntityFieldEncryption,
  createTenantDb,
  decryptEntityFieldValues,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  type EscapeHatchAuditSink,
  EXT_USER_DATA,
  extensionUsageEscapeHatchReason,
  maskWriteOnlyFields,
  type Registry,
  type TenantId,
  type UserDataExportHook,
  type UserDataExportSnippet,
} from "@cosmicdrift/kumiko-framework/engine";
import { runInSystemRowLevelSecurityScope } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import {
  createEscapeHatchReporter,
  UNATTRIBUTED_ACTOR,
} from "@cosmicdrift/kumiko-framework/pipeline";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { tenantMembershipsTable } from "../tenant/index.ts";
import { buildFileRefZipPath } from "./zip-path.ts";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

export interface RunUserExportArgs {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly userId: string;
  readonly now: Instant;
  // Sourced from the owning job's ctx (_escapeHatchAuditSink,
  // systemUser.id); attributes+audits any EXT_USER_DATA usage's declared
  // escapeHatch when its export hook calls ctx.db.unsafeRaw().
  readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
  readonly escapeHatchAuditLog?: Logger;
  readonly actor?: string;
}

export interface UserExportFileRef {
  readonly fileRefId: string;
  readonly storageKey: string;
  readonly fileName: string;
  /** Tenant containing the file; the same fileRefId cannot be shared across tenants. */
  readonly tenantId: TenantId;
  /**
   * ZIP-internal path under which the file is placed in the export ZIP.
   * Reader tools (compliance audit, self-service portal) use this field
   * to link bundle.json fileRefs[] to the files/-paths. Guaranteed to be
   * safe from path traversal via sanitizeZipFilename.
   */
  readonly zipPath: string;
}

export interface UserExportTenantSection {
  readonly tenantId: TenantId;
  /** One snippet per entity ({entity, rows[]}); empty when the hook returns null. */
  readonly entities: ReadonlyArray<UserDataExportSnippet>;
}

export interface UserExportBundle {
  readonly userId: string;
  /** ISO-8601 generation timestamp for the audit trail. */
  readonly generatedAt: string;
  /** One section for each tenant the user belongs to; orphan users have tenants=[]. */
  readonly tenants: ReadonlyArray<UserExportTenantSection>;
  /**
   * Flat list of all fileRefs from every tenant section. The later ZIP
   * construction job iterates over this list and retrieves binaries from
   * the storage provider. Until then, it is the operator's manifest.
   */
  readonly fileRefs: ReadonlyArray<UserExportFileRef>;
}

interface HookEntry {
  readonly entityName: string;
  readonly exportHook: UserDataExportHook;
  readonly escapeHatchReason: string | undefined;
}

function buildHookDb(
  db: DbRunner,
  tenantId: TenantId,
  entry: HookEntry,
  args: Pick<RunUserExportArgs, "escapeHatchAuditSink" | "escapeHatchAuditLog" | "actor">,
) {
  const report = createEscapeHatchReporter({
    handler: `${EXT_USER_DATA}:${entry.entityName}`,
    tenantId,
    actor: args.actor ?? UNATTRIBUTED_ACTOR,
    sink: args.escapeHatchAuditSink,
    log: args.escapeHatchAuditLog ?? createFallbackLogger("user-data-rights"),
  });
  return createTenantDb({
    db,
    tenantId,
    mode: "tenant",
    grants: {
      unsafeRaw:
        entry.escapeHatchReason !== undefined ? { reason: entry.escapeHatchReason } : undefined,
      report,
    },
  });
}

/**
 * Pure function: invokes all EXT_USER_DATA hooks for each tenant
 * membership and collects snippets into a UserExportBundle.
 *
 * **Memory footprint:**
 *
 * The entire storage path is streaming-bound:
 *   - File binaries use provider.readStream and chunk streaming, scaling
 *     to arbitrary file sizes without a heap spike.
 *   - ZIP writing uses provider.writeStream; local storage uses
 *     fs.createWriteStream, while S3 uses lib-storage.Upload (multipart,
 *     with an approximately 20 MB heap bound at 4 concurrent parts).
 *
 * **Only non-streaming path:** the bundle object itself (the bundle.json
 * content). It is built entirely in memory before `bundleToZipEntries`
 * yields it as a ZIP entry. Hooks return snippets as plain objects
 * (see UserDataExportSnippet).
 *
 * **Threshold:** A web app with approximately 500 table rows per user
 * produces about 500 KB of JSON. 50k rows produce about 50 MB. 100k+
 * rows per user (for example, long-running rental-portal logs) create
 * noticeable heap pressure.
 *
 * **If this becomes a problem:** refactor runUserExport to use an
 * AsyncIterable; hooks would yield snippets instead of returning objects,
 * and the bundle schema would use JSON Lines. bundleToZipEntries would
 * stream entries line by line. This is a non-trivial schema change.
 *
 * **Operator signal:** if bundle.json exceeds 100 MB in the ZIP, trigger
 * telemetry and evaluate a schema refactor.
 */
// Cross-tenant by design: the membership read on the given runner and raw hook statements
// must see every tenant of the user, whatever RLS scope the caller runs in.
export function runUserExport(args: RunUserExportArgs): Promise<UserExportBundle> {
  return runInSystemRowLevelSecurityScope(() => exportUserData(args));
}

async function exportUserData(args: RunUserExportArgs): Promise<UserExportBundle> {
  const { db, registry, userId, now } = args;

  const memberships = await selectMany<{ tenantId: TenantId }>(db, tenantMembershipsTable, {
    userId,
  });

  const tenantList: TenantId[] = memberships.map((m) => m.tenantId);

  // EXT_USER_DATA-Usages → export-Hook-Liste.
  const usages = registry.getExtensionUsages(EXT_USER_DATA);
  const hookEntries: HookEntry[] = usages
    .map((u): HookEntry | null => {
      const opts = (u.options ?? {}) as { export?: UserDataExportHook }; // @cast-boundary engine-payload
      return opts.export
        ? {
            entityName: u.entityName,
            exportHook: opts.export,
            escapeHatchReason: extensionUsageEscapeHatchReason(u),
          }
        : null;
    })
    .filter((x): x is HookEntry => x !== null);

  const tenants: UserExportTenantSection[] = [];
  const fileRefs: UserExportFileRef[] = [];

  for (const tenantId of tenantList) {
    const entities: UserDataExportSnippet[] = [];
    for (const entry of hookEntries) {
      const rawSnippet = await entry.exportHook({
        db: buildHookDb(db, tenantId, entry, args),
        registry,
        tenantId,
        userId,
      });
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

  // Edge case "0 memberships": tenant-agnostic hooks (for example, the
  // user hook) would run multiple times during cross-tenant iteration.
  // An orphan user with no membership would otherwise skip them entirely.
  // As in the forget runner, add a special run with a pseudo-tenant so
  // the global user row is included in the bundle. Tenant-scoped hooks
  // are no-ops.
  //
  // Cross-tenant consistency must not silently break when memberships are
  // empty.
  if (tenantList.length === 0 && hookEntries.length > 0) {
    const orphanEntities: UserDataExportSnippet[] = [];
    for (const entry of hookEntries) {
      const rawSnippet = await entry.exportHook({
        db: buildHookDb(db, SYSTEM_TENANT_ID_FOR_ORPHANS, entry, args),
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

// Art. 20 requires the data, not its ciphertext: export hooks read raw
// rows outside the executor's decryption layer, so this central pass
// decrypts encrypted entity fields after each hook. Without a configured
// cipher, it exports an explicit marker instead of presenting the base64
// blob as a value (leak by confusion).
const ENCRYPTED_UNAVAILABLE = "[encrypted:unavailable]";

// Shared decrypt sweep, used for both `snippet.rows` and `snippet.fileRefs`
// `encryptedFields` is keyed by field NAME, so it stays a no-op
// for today's `fileRef` entity but covers a future generically-encrypted
// side-channel field too.
async function decryptRecords(
  records: ReadonlyArray<Record<string, unknown>>,
  encryptedFields: ReadonlySet<string>,
  kms: ReturnType<typeof configuredPiiSubjectKms>,
): Promise<Record<string, unknown>[]> {
  let rows: Record<string, unknown>[] = [...records];

  if (encryptedFields.size > 0) {
    const cipher = configuredEntityFieldEncryption();
    rows = await Promise.all(
      rows.map(async (row) => {
        if (cipher) return decryptEntityFieldValues(row, encryptedFields, cipher);
        const out = { ...row };
        for (const name of encryptedFields) {
          if (typeof out[name] === "string") out[name] = ENCRYPTED_UNAVAILABLE;
        }
        return out;
      }),
    );
  }

  // PII-subject ciphertexts (kumiko-pii:) are self-describing — no entity
  // context needed, covers every hook past and future. Erased subject →
  // sentinel (honest: the value is shredded).
  return Promise.all(
    rows.map(async (row) => {
      const piiKeys = Object.keys(row).filter((k) => isPiiCiphertext(row[k]));
      if (piiKeys.length === 0) return row;
      if (!kms) {
        const out = { ...row };
        for (const k of piiKeys) out[k] = ENCRYPTED_UNAVAILABLE;
        return out;
      }
      return decryptPiiFieldValues(row, piiKeys, kms, {
        requestId: "user-data-rights:export",
      });
    }),
  );
}

async function decryptSnippetFields(
  registry: Registry,
  hookEntityName: string,
  snippet: UserDataExportSnippet,
): Promise<UserDataExportSnippet> {
  const entity = registry.getEntity(snippet.entity) ?? registry.getEntity(hookEntityName);
  const encryptedFields = entity ? collectEncryptedFieldNames(entity) : new Set<string>();
  const kms = configuredPiiSubjectKms();

  const decryptedRows = await decryptRecords(snippet.rows, encryptedFields, kms);
  // Decrypting would otherwise hand writeOnly secrets out as plaintext.
  const rows = entity
    ? decryptedRows.map((row) => maskWriteOnlyFields(entity, row))
    : decryptedRows;

  if (!snippet.fileRefs || snippet.fileRefs.length === 0) {
    return { ...snippet, rows };
  }

  const decryptedFileRefs = await decryptRecords(snippet.fileRefs, encryptedFields, kms);
  const fileRefs = decryptedFileRefs.map((r) => ({
    fileRefId: String(r["fileRefId"]),
    storageKey: String(r["storageKey"]),
    fileName: String(r["fileName"]),
  }));

  return { ...snippet, rows, fileRefs };
}

// Pseudo-tenant for users without active memberships. It uses an
// RFC4122 null UUID; tenant-scoped hooks find no data here (no-op).
const SYSTEM_TENANT_ID_FOR_ORPHANS = "00000000-0000-0000-0000-000000000000" as TenantId;
