// Async Export-Job Worker (S2.U3 Atom 3b) — pure Pipeline-Function.
//
// Spec: docs/plans/architecture/user-data-rights.md "Async Export-Pipeline".
// Cron-getriggert (siehe r.job-Wrap im feature.ts), iteriert ueber alle
// pending-Jobs in einem Pass, fuehrt pro Job aus:
//
//   1. Claim: `crud.update({status: running, startedAt})` mit
//      optimistic-locking via version-Spalte. Wenn 2 Worker-Replicas
//      denselben Job picken wollen, gewinnt der erste, der zweite
//      kriegt VersionConflictError + skippt.
//
//   2. Bundle bauen: runUserExport({db, registry, userId, now}) →
//      UserExportBundle (siehe run-user-export.ts). Cross-Tenant-
//      Iteration ueber Memberships ist dort implementiert.
//
//   3. Profile-Resolution: `resolveProfileForTenant(requestedFromTenantId)`
//      liefert effective compliance-profile. exportDownloadTtl wird
//      fuer expiresAt-Berechnung gebraucht.
//
//   4. Storage-Provider builden: `buildStorageProvider(ctx, requestedFromTenantId)`
//      — file-foundation's createFileProviderForTenant-Pattern.
//      Pro Tenant unterschiedlicher Provider moeglich (S3 vs lokal).
//
//   5. ZIP-Stream: `createZipStream(bundleAsZipEntries(bundle))` →
//      AsyncIterable<Uint8Array>. Wir wrappen das in einen tracking-
//      Iterator der bytesWritten zaehlt.
//
//   6. Storage-Write: provider.writeStream(storageKey, zipStream).
//      Atomar via tmp+rename (lokal) bzw. multipart-upload (S3).
//
//   7. Job=done: `crud.update({status: "done", completedAt, expiresAt,
//      downloadStorageKey, bytesWritten})`.
//
// Bei Throw zwischen 2-7: Job=failed mit errorMessage. Storage-Write
// ist atomar (writeStream rollback bei Error im Source-Stream), keine
// halb-fertigen ZIPs am final-Pfad.
//
// **Stale-Detection:** vor dem Pickup-Pass laeuft ein separater
// Stale-Pass: Jobs in `running` mit `startedAt + exportStaleTimeoutMinutes
// < now` werden auf `failed` geflippt. Worker-Crashes / OOM-Kills /
// Replica-Restarts hinterlassen sonst stuck-running-Jobs.
//
// **Storage-Cleanup:** dritter Pass loescht abgelaufene downloadStorageKeys
// (`expiresAt + exportStorageCleanupGraceHours < now`) — abgelaufene ZIPs
// auf S3 sollen nicht ewig liegen.

import { addDurationSpec } from "@cosmicdrift/kumiko-framework/compliance";
import type { DbConnection, DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  createZipStream,
  type FileStorageProvider,
  type ZipEntry,
} from "@cosmicdrift/kumiko-framework/files";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { and, asc, eq, lte } from "drizzle-orm";
import { resolveProfileForTenant } from "../compliance-profiles";
import { runUserExport, type UserExportBundle } from "./run-user-export";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "./schema/export-job";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

const crud = createEventStoreExecutor(exportJobsTable, exportJobEntity, {
  entityName: "export-job",
});

export interface RunExportJobsArgs {
  readonly db: DbConnection;
  readonly registry: Registry;
  /**
   * Per-Tenant Storage-Provider-Builder. App-Bootstrap liefert den
   * file-foundation-Resolver via `createFileProviderForTenant` —
   * Worker bekommt eine kleinere Surface ohne HandlerContext-Dep.
   */
  readonly buildStorageProvider: (tenantId: TenantId) => Promise<FileStorageProvider>;
  /** Now-Injection — Tests pinnen den Wert ohne Date-Mock. */
  readonly now: Instant;
}

export interface ExportJobError {
  readonly jobId: string;
  readonly userId: string;
  readonly phase: "claim" | "bundle" | "zip-write" | "complete";
  readonly message: string;
}

export interface RunExportJobsResult {
  /** Job-IDs die in diesem Pass von pending → done geflippt wurden. */
  readonly completedJobIds: readonly string[];
  /** Job-IDs die in diesem Pass von pending → failed geflippt wurden. */
  readonly failedJobIds: readonly string[];
  /** Job-IDs die als stuck-running auf failed geflippt wurden (Stale-Pass). */
  readonly staleFailedJobIds: readonly string[];
  /** Job-IDs deren downloadStorageKey im Cleanup-Pass geloescht wurde. */
  readonly cleanedJobIds: readonly string[];
  readonly errors: readonly ExportJobError[];
}

export async function runExportJobs(args: RunExportJobsArgs): Promise<RunExportJobsResult> {
  const { db, registry, buildStorageProvider, now } = args;

  // Pass 1: Stale-Detection — running jobs die laenger als das tenant-
  // spezifische exportStaleTimeoutMinutes haengen werden gefailed.
  // Wird VOR dem pickup-pass ausgefuehrt damit ein neuer Worker-Run
  // den vorhergehenden Crash erstmal als failed markiert.
  const staleFailedJobIds = await staleDetectionPass({ db, now });

  // Pass 2: Pickup pending jobs + Process them.
  const completedJobIds: string[] = [];
  const failedJobIds: string[] = [];
  const errors: ExportJobError[] = [];

  const pendingJobs = await fetchPendingJobs(db);
  for (const job of pendingJobs) {
    const outcome = await processJob({
      db,
      registry,
      buildStorageProvider,
      now,
      job,
    });
    if (outcome.kind === "done") {
      completedJobIds.push(job.id);
    } else if (outcome.kind === "failed") {
      failedJobIds.push(job.id);
      errors.push(outcome.error);
    }
    // "skipped" (claim race lost) wird still passiert — kein error,
    // anderer Worker hat den Job bereits.
  }

  // Pass 3: Storage-Cleanup — abgelaufene done-Jobs (expiresAt+grace < now)
  // bekommen ihren downloadStorageKey aus dem Storage-Provider geloescht
  // + im DB-Row genullt.
  const cleanedJobIds = await storageCleanupPass({
    db,
    buildStorageProvider,
    now,
  });

  return {
    completedJobIds,
    failedJobIds,
    staleFailedJobIds,
    cleanedJobIds,
    errors,
  };
}

interface JobRow {
  readonly id: string;
  readonly version: number;
  readonly userId: string;
  readonly requestedFromTenantId: TenantId;
}

async function fetchPendingJobs(db: DbRunner): Promise<readonly JobRow[]> {
  // @cast-boundary db-row.
  return (await db
    .select({
      id: exportJobsTable["id"],
      version: exportJobsTable["version"],
      userId: exportJobsTable["userId"],
      requestedFromTenantId: exportJobsTable["requestedFromTenantId"],
    })
    .from(exportJobsTable)
    .where(eq(exportJobsTable["status"], EXPORT_JOB_STATUS.Pending))
    .orderBy(asc(exportJobsTable["requestedAt"]))) as readonly JobRow[];
}

type ProcessOutcome =
  | { kind: "done" }
  | { kind: "failed"; error: ExportJobError }
  | { kind: "skipped" }; // claim-race-loss (anderer Worker)

async function processJob(args: {
  db: DbConnection;
  registry: Registry;
  buildStorageProvider: (tenantId: TenantId) => Promise<FileStorageProvider>;
  now: Instant;
  job: JobRow;
}): Promise<ProcessOutcome> {
  const { db, registry, buildStorageProvider, now, job } = args;
  const executor = createSystemUser(job.requestedFromTenantId);
  // crud.update braucht TenantDb fuer Stream-Identity (Memory
  // feedback_event_store_tenant_consistency). system-mode bypassed
  // den auto-tenant-filter; Stream wird ueber requestedFromTenantId
  // konsistent gehalten.
  const tdb = systemTenantDb(db, job.requestedFromTenantId);

  // Phase 1: Claim — version-bumped update, scheitert via VersionConflict
  // wenn paralleler Worker schon claimed hat.
  const claimResult = await crud.update(
    {
      id: job.id,
      version: job.version,
      changes: { status: EXPORT_JOB_STATUS.Running, startedAt: now },
    },
    executor,
    tdb,
  );
  if (!claimResult.isSuccess) {
    // Race-Loss: anderer Worker hat den Job claimed. Skip silently.
    return { kind: "skipped" };
  }

  // Phase 2-6: Bundle bauen + ZIP-streamen + Storage-Write.
  // Errors bis zur completion werden als job=failed materialisiert.
  try {
    const bundle = await runUserExport({
      db,
      registry,
      userId: job.userId,
      now,
    });

    const profile = await resolveProfileForTenant({
      db,
      tenantId: job.requestedFromTenantId,
    });
    const ttl = profile.profile.userRights.exportDownloadTtl;

    // Per-Tenant-Provider-Cache: Cross-Tenant-fileRefs (Alice Member von
    // Tenant A + B → File-Refs aus beiden) brauchen pro Tenant separat
    // einen Provider-Build (S3-Bucket pro Tenant, andere config). Job-
    // Tenant ist die Identitaet fuer den write-Pfad; read-Pfade gehen
    // ueber den fileRef.tenantId.
    const providerCache = new Map<TenantId, FileStorageProvider>();
    const cachedProvider = async (tenantId: TenantId): Promise<FileStorageProvider> => {
      let p = providerCache.get(tenantId);
      if (!p) {
        p = await buildStorageProvider(tenantId);
        providerCache.set(tenantId, p);
      }
      return p;
    };

    const writeProvider = await cachedProvider(job.requestedFromTenantId);
    // writeStream + readStream sind im FileStorageProvider-Type required
    // (Atom 3c.fix Type-Honesty) — keine Runtime-Optional-Checks mehr noetig.

    const storageKey = buildExportStorageKey(job);
    const tracker = countingStream(
      createZipStream(bundleToZipEntries(bundle, now, cachedProvider)),
    );

    await writeProvider.writeStream(storageKey, tracker.stream, {
      mimeType: "application/zip",
    });

    // Phase 7: Job=done.
    const expiresAt = addDurationSpec(now, ttl);
    const doneResult = await crud.update(
      {
        id: job.id,
        version: job.version + 1, // +1 weil wir bereits via claim einen update gemacht haben
        changes: {
          status: EXPORT_JOB_STATUS.Done,
          completedAt: now,
          downloadStorageKey: storageKey,
          expiresAt,
          bytesWritten: tracker.bytes,
        },
      },
      executor,
      tdb,
    );
    if (!doneResult.isSuccess) {
      // Sehr unerwartet — wir haben gerade claimed (version+1), niemand
      // sollte den Job zwischenzeitlich aendern. Materialisieren als
      // failed damit der Operator das sieht.
      throw new Error(
        `Job ${job.id}: failed to flip status=done after successful ZIP-write. ` +
          `${(doneResult as { error?: { code?: string } }).error?.code ?? "unknown"}`,
      );
    }
    return { kind: "done" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Best-effort failure-flip. Wenn auch das failed (DB down etc.),
    // bleibt der Job in running stehen — Stale-Detection im naechsten
    // Worker-Run faengt ihn dann auf.
    await crud
      .update(
        {
          id: job.id,
          version: job.version + 1,
          changes: {
            status: EXPORT_JOB_STATUS.Failed,
            completedAt: now,
            errorMessage: message,
          },
        },
        executor,
        tdb,
      )
      .catch(() => {
        /* swallow — stale-detection kommt im nachsten Pass */
      });
    return {
      kind: "failed",
      error: {
        jobId: job.id,
        userId: job.userId,
        phase: "zip-write",
        message,
      },
    };
  }
}

async function staleDetectionPass(args: {
  db: DbConnection;
  now: Instant;
}): Promise<readonly string[]> {
  const { db, now } = args;

  // **Kein Coarse-Filter** — der vorherige `startedAt <= now-1h` Filter
  // war fragile: profile.exportStaleTimeoutMinutes hat Default 30min und
  // erlaubt per-Tenant-Override auf z.B. 5min. Ein 60min-Coarse-Filter
  // wuerde 30-60min-alte stale-Jobs UNERKANNT lassen. Cron laeuft alle
  // 60s, zu jedem Zeitpunkt sind nur wenige Jobs in `running` —
  // alle fetchen + profile-resolve im Loop ist bezahlbar + korrekt.
  // @cast-boundary db-row.
  const candidates = (await db
    .select({
      id: exportJobsTable["id"],
      version: exportJobsTable["version"],
      userId: exportJobsTable["userId"],
      requestedFromTenantId: exportJobsTable["requestedFromTenantId"],
      startedAt: exportJobsTable["startedAt"],
    })
    .from(exportJobsTable)
    .where(eq(exportJobsTable["status"], EXPORT_JOB_STATUS.Running))) as readonly {
    id: string;
    version: number;
    userId: string;
    requestedFromTenantId: TenantId;
    startedAt: Instant | null;
  }[];

  const failed: string[] = [];
  for (const c of candidates) {
    const profile = await resolveProfileForTenant({
      db,
      tenantId: c.requestedFromTenantId,
    });
    const cutoffMs =
      now.epochMilliseconds - profile.profile.userRights.exportStaleTimeoutMinutes * 60 * 1000;
    const startedMs = c.startedAt?.epochMilliseconds ?? Number.MAX_SAFE_INTEGER;
    if (startedMs < cutoffMs) {
      const result = await crud.update(
        {
          id: c.id,
          version: c.version,
          changes: {
            status: EXPORT_JOB_STATUS.Failed,
            completedAt: now,
            errorMessage: "stale: worker crashed mid-run",
          },
        },
        createSystemUser(c.requestedFromTenantId),
        systemTenantDb(db, c.requestedFromTenantId),
      );
      if (result.isSuccess) failed.push(c.id);
      // Race-loss (Worker hat das Job parallel completed) → skip
    }
  }
  return failed;
}

async function storageCleanupPass(args: {
  db: DbConnection;
  buildStorageProvider: (tenantId: TenantId) => Promise<FileStorageProvider>;
  now: Instant;
}): Promise<readonly string[]> {
  const { db, buildStorageProvider, now } = args;

  // Done-Jobs deren expiresAt+grace bereits vorbei ist + die noch einen
  // downloadStorageKey haben. Per-Tenant-Grace ist im Profile, wir
  // grob-filtern auf expiresAt <= now (kleinster grace=0) + checken
  // im Loop genau.
  // @cast-boundary db-row.
  const candidates = (await db
    .select({
      id: exportJobsTable["id"],
      version: exportJobsTable["version"],
      requestedFromTenantId: exportJobsTable["requestedFromTenantId"],
      downloadStorageKey: exportJobsTable["downloadStorageKey"],
      expiresAt: exportJobsTable["expiresAt"],
    })
    .from(exportJobsTable)
    .where(
      and(
        eq(exportJobsTable["status"], EXPORT_JOB_STATUS.Done),
        lte(exportJobsTable["expiresAt"], now),
      ),
    )) as readonly {
    id: string;
    version: number;
    requestedFromTenantId: TenantId;
    downloadStorageKey: string | null;
    expiresAt: Instant | null;
  }[];

  const cleaned: string[] = [];
  for (const c of candidates) {
    if (!c.downloadStorageKey || !c.expiresAt) continue;
    const profile = await resolveProfileForTenant({
      db,
      tenantId: c.requestedFromTenantId,
    });
    const cleanupAfter =
      c.expiresAt.epochMilliseconds +
      profile.profile.userRights.exportStorageCleanupGraceHours * 60 * 60 * 1000;
    if (now.epochMilliseconds < cleanupAfter) continue;

    // Storage-Datei loeschen + DB-Spalte nullen.
    try {
      const provider = await buildStorageProvider(c.requestedFromTenantId);
      await provider.delete(c.downloadStorageKey);
    } catch {
      // best-effort; wenn Storage-Delete failed, retry beim naechsten Pass
      continue;
    }
    const result = await crud.update(
      {
        id: c.id,
        version: c.version,
        changes: { downloadStorageKey: null },
      },
      createSystemUser(c.requestedFromTenantId),
      systemTenantDb(db, c.requestedFromTenantId),
    );
    if (result.isSuccess) cleaned.push(c.id);
  }
  return cleaned;
}

// Wrapper: crud.update braucht TenantDb. ExportJob ist tenant-agnostisch
// (1 Job pro userId), aber der event-store-Stream-Lookup erwartet einen
// Tenant-Context. system-mode TenantDb bypassed den auto-tenant-filter
// — wir nutzen `requestedFromTenantId` als Stream-Identity damit der
// Stream-Counter konsistent bleibt (Memory feedback_event_store_tenant_consistency).
function systemTenantDb(db: DbConnection, tenantId: TenantId) {
  return createTenantDb(db, tenantId, "system");
}

function buildExportStorageKey(job: JobRow): string {
  // Tenant-prefix damit der Storage-Layout pro-Tenant separat liegt.
  // job.id ist UUID → URL-safe.
  return `${job.requestedFromTenantId}/exports/${job.id}.zip`;
}

/**
 * Konvertiert das UserExportBundle in eine `AsyncIterable<ZipEntry>`
 * fuer createZipStream.
 *
 * Bundle-Layout (Atom 3c):
 *   bundle.json                              — Top-Level-Bundle-Metadata
 *                                              + tenant-sections + flat
 *                                              fileRefs[] mit zipPath
 *                                              pro Datei
 *   files/<tenantId>/<fileRefId>-<name>      — File-Binaries, Pfad
 *                                              identisch zu fileRef.zipPath
 *                                              im JSON. Bytes via
 *                                              provider.readStream — kein
 *                                              Memory-Spike, auch grosse
 *                                              PDFs streamen durch.
 *
 * `getProvider` ist ein async-cached Resolver pro tenantId. Caller
 * (processJob) baut die Caching-Map damit jeder Tenant nur EINMAL
 * via `buildStorageProvider` materialisiert wird.
 */
async function* bundleToZipEntries(
  bundle: UserExportBundle,
  mtime: Instant,
  getProvider: (tenantId: TenantId) => Promise<FileStorageProvider>,
): AsyncIterable<ZipEntry> {
  const mtimeDate = new Date(mtime.epochMilliseconds);

  // bundle.json zuerst — Reader-Tools koennen das frueh parsen.
  const bundleJson = JSON.stringify(bundle, null, 2);
  yield {
    path: "bundle.json",
    data: oneShot(new TextEncoder().encode(bundleJson)),
    mtime: mtimeDate,
  };

  // File-Binaries: pro fileRef einen ZIP-Entry. data ist der readStream
  // direkt — der ZIP-Builder konsumiert chunk-fuer-chunk, kein Upfront-
  // Memory-Spike pro File. Bei 50 PDFs à 10MB werden trotzdem max. ~64KB
  // (default highWaterMark) gleichzeitig im Heap gehalten.
  for (const ref of bundle.fileRefs) {
    const provider = await getProvider(ref.tenantId);
    // readStream ist required im FileStorageProvider-Type (Atom 3c.fix
    // Type-Honesty) — kein Runtime-Optional-Check noetig.
    yield {
      path: ref.zipPath,
      data: provider.readStream(ref.storageKey),
      mtime: mtimeDate,
    };
  }
}

async function* oneShot(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

/**
 * Wraps an `AsyncIterable<Uint8Array>` und zaehlt total-bytes. Nach
 * `for await` ist `tracker.bytes` der finale Wert. Verwendet fuer
 * bytesWritten im Job-Row.
 */
function countingStream(source: AsyncIterable<Uint8Array>): {
  stream: AsyncIterable<Uint8Array>;
  readonly bytes: number;
} {
  const tracker = { bytes: 0 };
  const stream: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      for await (const chunk of source) {
        tracker.bytes += chunk.byteLength;
        yield chunk;
      }
    },
  };
  return {
    stream,
    get bytes() {
      return tracker.bytes;
    },
  };
}
