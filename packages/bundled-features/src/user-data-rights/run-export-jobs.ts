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

import { asRawClient, fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
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
import { resolveProfileForTenant } from "../compliance-profiles";
import { userTable } from "../user";
import { runUserExport, type UserExportBundle } from "./run-user-export";
import { exportDownloadTokenEntity, exportDownloadTokensTable } from "./schema/download-token";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "./schema/export-job";
import { generateDownloadToken } from "./token-helpers";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

const crud = createEventStoreExecutor(exportJobsTable, exportJobEntity, {
  entityName: "export-job",
});

// Atom 4a — separater ES-Executor fuer Download-Tokens. crud.create
// emittiert `exportDownloadToken.created`-Event in den event-store +
// projected synchron auf read_export_download_tokens. KEIN direct-INSERT
// (Memory `feedback_no_fake_dispatcher`).
//
// Exportiert weil Atom 4b's download-handler tokenCrud.update fuer
// Audit-Felder (useCount, lastUsedAt, IP, UA) nutzt — ES-konsistent.
export const tokenCrud = createEventStoreExecutor(
  exportDownloadTokensTable,
  exportDownloadTokenEntity,
  { entityName: "export-download-token" },
);

/**
 * Notification-Callback fuer den done-Pfad. Pattern matched
 * auth-routes.PasswordResetConfig.sendResetEmail. Plain-Token bleibt
 * ephemeral (nicht in DB/event-store/jobRunsTable). App-Author wired
 * den Callback an seinen Email-Provider:
 *   - existing `delivery.notify` (multi-channel + delivery_attempts-Log)
 *   - `mailFoundation.send` direkt
 *   - Custom Resend/SES/etc.
 *
 * **Best-effort:** Throw vom Callback bubbelt zum r.job-Wrap; jobs-
 * Feature persistiert den Worker-Run als failed in jobRunsTable. Der
 * Failed-Pfad wird in `jobs/__tests__/jobs-feature.integration.ts`
 * Scenario 2 gepinnt — wir verweisen darauf statt end-zu-end zu
 * duplizieren. Operator sieht's im /jobs-Dashboard, kann via
 * jobs:write:retry den Worker-Run erneut anstossen (Job selbst bleibt
 * done; retry findet keinen pending mehr, aber Audit-Log zeigt den
 * Failure).
 *
 * **Plain-Token-Recovery bei Email-Fail:** plain ist ephemeral. Wenn
 * der Callback throwt, ist der plain verloren. Operator-Eingriff
 * noetig (Token in DB nullen + Job auf pending → next Worker-Run
 * generiert neuen Token). Atom 5b (Re-issue-handler) wird das
 * automatisieren.
 */
export type SendExportReadyEmailFn = (args: {
  readonly userId: string;
  readonly userEmail: string;
  readonly tenantId: TenantId;
  readonly jobId: string;
  readonly downloadUrl: string;
  readonly expiresAt: string;
  readonly bytesWritten: number | null;
}) => Promise<void>;

export type SendExportFailedEmailFn = (args: {
  readonly userId: string;
  readonly userEmail: string;
  readonly tenantId: TenantId;
  readonly jobId: string;
  readonly errorMessage: string;
}) => Promise<void>;

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

  /** S2.U3 Atom 5 — Email-Notification beim done-flip. Optional;
   *  wenn nicht gesetzt, sendet der Worker keine notification (User
   *  kann aber via export-status.query polln + UI-Klick). */
  readonly sendExportReadyEmail?: SendExportReadyEmailFn;
  /** Optional Email beim failed-flip. */
  readonly sendExportFailedEmail?: SendExportFailedEmailFn;
  /** Base-URL fuer den Magic-Link. App-Author setzt das (z.B.
   *  "https://app.example.com/user-export/by-token"). Worker baut
   *  `${appExportDownloadUrl}?token=<plain>` und reicht das im
   *  Callback durch. Required wenn sendExportReadyEmail gesetzt. */
  readonly appExportDownloadUrl?: string;
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
  /**
   * Plain-Tokens fuer in diesem Pass completed-Jobs. Map<jobId, plain>.
   * Atom 5 (Notification) liest das + versendet plain per Email.
   * NIEMALS persistiert — nur in-memory zwischen Worker-Run und
   * Notification-Hook. NACH dem Run ist plain nur via DB-Hash
   * verifizierbar (Atom 4b's Download-Endpoint).
   */
  readonly tokenByJobId: ReadonlyMap<string, string>;
}

export async function runExportJobs(args: RunExportJobsArgs): Promise<RunExportJobsResult> {
  const { db, registry, buildStorageProvider, now, sendExportReadyEmail, sendExportFailedEmail } =
    args;

  // Boot-Misconfig-Check: wer sendExportReadyEmail setzt aber URL
  // vergisst, soll einen klaren Error sehen — VOR dem Pass-Loop, damit
  // der Throw nicht vom per-Job-try/catch (Atom 5.fix3) geschluckt wird.
  // Runtime-Callback-Failures sind best-effort, Boot-Misconfig ist hard-
  // fail (App-Author-Bug, kein Network-Hiccup).
  if (sendExportReadyEmail && args.appExportDownloadUrl === undefined) {
    throw new Error(
      "user-data-rights: sendExportReadyEmail gesetzt aber appExportDownloadUrl fehlt — beide muessen zusammen konfiguriert sein",
    );
  }

  // Pass 1: Stale-Detection — running jobs die laenger als das tenant-
  // spezifische exportStaleTimeoutMinutes haengen werden gefailed.
  // Wird VOR dem pickup-pass ausgefuehrt damit ein neuer Worker-Run
  // den vorhergehenden Crash erstmal als failed markiert.
  const staleFailedJobIds = await staleDetectionPass({ db, now });

  // Pass 2: Pickup pending jobs + Process them.
  const completedJobIds: string[] = [];
  const failedJobIds: string[] = [];
  const errors: ExportJobError[] = [];
  const tokenByJobId = new Map<string, string>();

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
      // Worker hat plain im Memory; weitergeben fuer downstream-callbacks
      // + Atom-5-Tests (RunExportJobsResult.tokenByJobId). Plain landet
      // NICHT in Logs/Telemetry/jobRunsTable.
      tokenByJobId.set(job.id, outcome.tokenPlain);

      // Atom 5: Email-Notification beim done-flip.
      //
      // Best-effort (Atom 5.fix3): Throw fuer Job A darf den Batch nicht
      // abwuergen — Job-Status ist bereits done committed, restliche
      // pending-Jobs muessen noch verarbeitet werden. Throw waere ein
      // Bug: r.job-Wrap markiert den Run failed, retry findet keinen
      // pending-Job mehr (Status=done) → silent miss + ZIP laeuft nach
      // TTL ab ohne dass der User die Email je bekommt. console.warn ist
      // die einzige Operator-Sichtbarkeit (runExportJobs-args fuehren
      // AppContext.log nicht durch — pure-function-Pattern).
      if (sendExportReadyEmail) {
        try {
          await fireExportReadyCallback({
            db,
            job,
            plainToken: outcome.tokenPlain,
            bytesWritten: outcome.bytesWritten,
            expiresAt: outcome.expiresAt,
            appExportDownloadUrl: args.appExportDownloadUrl,
            send: sendExportReadyEmail,
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: operator-visibility for email-send-failure
          console.warn(
            `[user-data-rights:run-export-jobs] sendExportReadyEmail failed jobId=${job.id} userId=${job.userId} err=${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else if (outcome.kind === "failed") {
      failedJobIds.push(job.id);
      errors.push(outcome.error);

      // Atom 5: Email-Notification beim failed-flip — User soll wissen
      // dass er neuen Export anfordern muss. Best-effort analog
      // sendExportReadyEmail (Atom 5.fix3) — Email-Send-Throw darf den
      // Batch nicht killen.
      if (sendExportFailedEmail) {
        try {
          await fireExportFailedCallback({
            db,
            job,
            errorMessage: outcome.error.message,
            send: sendExportFailedEmail,
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: operator-visibility for email-send-failure
          console.warn(
            `[user-data-rights:run-export-jobs] sendExportFailedEmail failed jobId=${job.id} userId=${job.userId} err=${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
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
    tokenByJobId,
  };
}

interface JobRow {
  readonly id: string;
  readonly version: number;
  readonly userId: string;
  readonly requestedFromTenantId: TenantId;
}

async function fetchPendingJobs(db: DbRunner): Promise<readonly JobRow[]> {
  return selectMany<JobRow>(
    db,
    exportJobsTable,
    { status: EXPORT_JOB_STATUS.Pending },
    {
      orderBy: { col: "requestedAt", direction: "asc" },
    },
  );
}

type ProcessOutcome =
  | {
      kind: "done";
      tokenPlain: string;
      expiresAt: Instant;
      bytesWritten: number;
    }
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
  //
  // **Path-pre-claim** (Atom 4a.fix): downloadStorageKey wird HIER schon
  // persistiert (deterministischer Pfad aus job.id). Begründung: wenn
  // Worker zwischen ZIP-write und done-flip crashed, hat der Job-Row
  // bereits den Pfad → storageCleanupPass kann den orphan-ZIP via
  // failed-Job-Cleanup-Pass loeschen (sonst forever-leak im S3).
  const storageKey = buildExportStorageKey(job);
  const claimResult = await crud.update(
    {
      id: job.id,
      version: job.version,
      changes: {
        status: EXPORT_JOB_STATUS.Running,
        startedAt: now,
        downloadStorageKey: storageKey,
      },
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

    const tracker = countingStream(
      createZipStream(bundleToZipEntries(bundle, now, cachedProvider)),
    );

    await writeProvider.writeStream(storageKey, tracker.stream, {
      mimeType: "application/zip",
    });

    // Phase 7: Token VOR done-flip (Atom 4a.fix Sequencing).
    //
    // Wenn Token-Create failt, bleibt Job in `running` → catch-Pfad
    // flippt auf failed (monotone Status-Transition). Wenn Token-Create
    // VOR und done-flip NACH: tightes Race-Window in dem ein Worker-
    // Crash zwischen den zwei calls einen Token + ZIP orphans. Beides
    // catched die Stale-Detection im naechsten Pass — Job=failed,
    // Storage-Cleanup-Pass clearted den ZIP (path-pre-claim oben).
    //
    // Plain-Token bleibt im Worker-Memory + wird via RunExportJobsResult
    // an Atom 5 (Notification) weitergegeben. NUR der hash landet in DB.
    // ES via tokenCrud.create — kein direct-INSERT.
    const expiresAt = addDurationSpec(now, ttl);
    const { plain: tokenPlain, hash: tokenHash } = await generateDownloadToken();
    const tokenCreateResult = await tokenCrud.create(
      {
        jobId: job.id,
        tokenHash,
        issuedAt: now,
        expiresAt,
        // Atom 4a.fix: useCount explizit 0 statt default null. 4b's
        // Verify-Pfad incrementiert via `useCount + 1` ohne COALESCE-
        // Defensiv-Code.
        useCount: 0,
      },
      executor,
      tdb,
    );
    if (!tokenCreateResult.isSuccess) {
      // Token-Creation failed VOR done-flip → Job bleibt running.
      // Catch-Pfad flippt auf failed mit klarer Diagnose. Storage-
      // Cleanup-Pass clearted den orphan-ZIP (path bereits via claim
      // persistiert).
      throw new Error(
        `Job ${job.id}: Token-Creation failed before done-flip. ` +
          `${(tokenCreateResult as { error?: { code?: string } }).error?.code ?? "unknown"}`, // @cast-boundary engine-payload
      );
    }

    // Phase 8: Job=done. expiresAt wurde oben fuer Token gesetzt; identisch
    // hier persistiert (denormalisiert in beiden Tabellen).
    const doneResult = await crud.update(
      {
        id: job.id,
        version: job.version + 1, // +1 weil wir bereits via claim einen update gemacht haben
        changes: {
          status: EXPORT_JOB_STATUS.Done,
          completedAt: now,
          // downloadStorageKey ist beim claim bereits gesetzt — kein
          // Re-Set hier noetig (waere identisch).
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
      // failed damit der Operator das sieht. Token-Row bleibt orphan
      // bis Atom-spaeter-Cleanup; Storage-ZIP wird via failed-Cleanup
      // gecleared.
      throw new Error(
        `Job ${job.id}: failed to flip status=done after successful Token-Create. ` +
          `${(doneResult as { error?: { code?: string } }).error?.code ?? "unknown"}`, // @cast-boundary engine-payload
      );
    }

    return { kind: "done", tokenPlain, expiresAt, bytesWritten: tracker.bytes };
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
  const candidates = await selectMany<{
    id: string;
    version: number;
    userId: string;
    requestedFromTenantId: TenantId;
    startedAt: Instant | null;
  }>(db, exportJobsTable, { status: EXPORT_JOB_STATUS.Running });

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

  // Zwei Cleanup-Pfade:
  //
  //   1. **Done-Jobs** (TTL-expired): expiresAt + grace < now → cleanup.
  //      Per-Tenant-Grace aus Profile (default 24h post-expiry damit
  //      gleichzeitige Re-Downloads bei Connection-Abbrueche moeglich).
  //
  //   2. **Failed-Jobs mit downloadStorageKey** (Atom 4a.fix orphan-cleanup):
  //      Worker hat ZIP geschrieben, dann ist VOR done-flip etwas
  //      schiefgegangen (Token-Create-Fail, done-flip-Fail, Stale-
  //      Detection mid-write). Job=failed mit gesetztem downloadStorageKey =
  //      ZIP-Orphan in Storage, kein User-Pfad zum download.
  //
  // **Strategie failed-Jobs: SOFORTIGE Cleanup ohne Grace.**
  //
  // Trade-off (DSGVO vs Audit-Forensik):
  //   - DSGVO: User-Daten-ZIP einer failed-export-Anfrage hat keinen
  //     legitimen Aufbewahrungs-Grund — hier ueberwiegt das Recht auf
  //     Loeschung
  //   - Audit-Forensik: forensische Untersuchung ("was ist im ZIP gelandet,
  //     warum failed der Job") wuerde von einer Grace-Periode profitieren —
  //     ABER: Token wurde nie ausgegeben (kein User hat das ZIP gesehen),
  //     also keine User-Schaden-Forensik. Operator-Audit hat job.errorMessage
  //     + Stack-Trace, das reicht
  // → Trade-off zugunsten DSGVO entschieden. Wenn ein Operator forensik
  // braucht, muss er das vor dem Cleanup-Pass capturen (out-of-band).
  //
  // **SQL-Filter:** WHERE-clause auf downloadStorageKey IS NOT NULL filtert
  // bereits in der DB statt im Loop. Bei skalierender DB-Historie (10k+
  // done-jobs nach 30 Tagen) reduziert das den Worker-Roundtrip drastisch.
  //
  // or() + isNotNull(): no bun-db helper covers this combination — raw SQL.
  const candidates = await asRawClient(db).unsafe<{
    id: string;
    version: number;
    status: string;
    requestedFromTenantId: TenantId;
    downloadStorageKey: string | null;
    expiresAt: Instant | null;
  }>(
    `SELECT id, version, status, requested_from_tenant_id AS "requestedFromTenantId", download_storage_key AS "downloadStorageKey", expires_at AS "expiresAt" FROM read_export_jobs WHERE status IN ($1, $2) AND download_storage_key IS NOT NULL`,
    [EXPORT_JOB_STATUS.Done, EXPORT_JOB_STATUS.Failed],
  );

  const cleaned: string[] = [];
  for (const c of candidates) {
    if (!c.downloadStorageKey) continue;

    // Done-Jobs brauchen expiresAt+grace-Check. Failed-Jobs gehen direkt
    // durch (kein User-Pfad → sofort cleanup).
    if (c.status === EXPORT_JOB_STATUS.Done) {
      if (!c.expiresAt) continue;
      const profile = await resolveProfileForTenant({
        db,
        tenantId: c.requestedFromTenantId,
      });
      const cleanupAfter =
        c.expiresAt.epochMilliseconds +
        profile.profile.userRights.exportStorageCleanupGraceHours * 60 * 60 * 1000;
      if (now.epochMilliseconds < cleanupAfter) continue;
    }
    // Failed-Job-Branch: kein TTL-Check, sofort cleanup.

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
  // bundle.json zuerst — Reader-Tools koennen das frueh parsen.
  const bundleJson = JSON.stringify(bundle, null, 2);
  yield {
    path: "bundle.json",
    data: oneShot(new TextEncoder().encode(bundleJson)),
    mtime,
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
      mtime,
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

// Atom 5 — userEmail-Lookup fuer notification-callback.
//
// **Direct-DB statt queryAs:** Worker-AppContext hat kein queryAs
// (anders als HandlerContext im request-Pfad). Pattern matched
// runUserExport's Cross-Tenant-Iteration die ebenso direkt
// tenantMembershipsTable liest. Cross-feature-API via dispatcher
// haette einen JobContext-Wrapper gebraucht den der framework noch
// nicht hat — wenn das mal kommt, ist der hier Refactor-Kandidat.
//
// **tenant-agnostic:** userTable.id ist UNIQUE (PK). Cross-Tenant
// (Alice in Tenant A+B) hat trotzdem nur 1 user-Row mit ihrer
// Heim-Tenant als tenantId. Lookup ohne tenantId-filter findet sie
// aus jedem Worker-Tenant-Context.
async function lookupUserEmail(db: DbConnection, userId: string): Promise<string | null> {
  // @cast-boundary db-row.
  const row = (await fetchOne(db, userTable, { id: userId })) as {
    email: string | null;
  } | null;
  return row?.email ?? null;
}

// Atom 5 — Email-Notification beim done-flip. Best-effort:
// Throw vom Callback bubbelt zum r.job-handler hoch + Worker-Run wird
// als failed in jobRunsTable gemerkt. Operator kann via jobs:write:retry
// den Worker-Run erneut anstossen — der Job selbst bleibt done, das
// retry findet keinen pending-Job mehr aber die Audit-Log zeigt den
// Failure.
async function fireExportReadyCallback(args: {
  readonly db: DbConnection;
  readonly job: JobRow;
  readonly plainToken: string;
  readonly expiresAt: Instant;
  readonly bytesWritten: number;
  readonly appExportDownloadUrl: string | undefined;
  readonly send: SendExportReadyEmailFn;
}): Promise<void> {
  const userEmail = await lookupUserEmail(args.db, args.job.userId);
  if (!userEmail) {
    // User-Row fehlt (z.B. forget-Pfad mid-export). Skip-Notification mit
    // Operator-Alert via job-run-Log statt Throw — Job bleibt done, User
    // hat ja seinen Token via export-status.query erreichbar (UI-Pfad).
    // **console.warn statt ctx.log:** runExportJobs-args fuehren AppContext.log
    // aktuell nicht durch (Worker-pure-function-Pattern). console.warn ist
    // die einzige Operator-Sichtbarkeit fuer den missing-user-edge-case.
    // Wenn jobs-Feature spaeter ctx.log threadet oder Worker-args erweitert
    // werden, hier Refactor-Kandidat.
    // biome-ignore lint/suspicious/noConsole: operator-visibility for missing-user edge-case
    console.warn(
      `[user-data-rights:run-export-jobs] userId=${args.job.userId} hat kein userEmail — sendExportReadyEmail skipped`,
    );
    // skip: missing user-email row; console.warn above provides operator visibility
    return;
  }
  const baseUrl = args.appExportDownloadUrl;
  if (!baseUrl) {
    throw new Error(
      "user-data-rights: sendExportReadyEmail gesetzt aber appExportDownloadUrl fehlt — beide muessen zusammen konfiguriert sein",
    );
  }
  const downloadUrl = `${baseUrl}?token=${encodeURIComponent(args.plainToken)}`;
  await args.send({
    userId: args.job.userId,
    userEmail,
    tenantId: args.job.requestedFromTenantId,
    jobId: args.job.id,
    downloadUrl,
    expiresAt: args.expiresAt.toString(),
    bytesWritten: args.bytesWritten,
  });
}

// Atom 5 — Email-Notification beim failed-flip.
async function fireExportFailedCallback(args: {
  readonly db: DbConnection;
  readonly job: JobRow;
  readonly errorMessage: string;
  readonly send: SendExportFailedEmailFn;
}): Promise<void> {
  const userEmail = await lookupUserEmail(args.db, args.job.userId);
  if (!userEmail) {
    // biome-ignore lint/suspicious/noConsole: operator-visibility
    console.warn(
      `[user-data-rights:run-export-jobs] userId=${args.job.userId} hat kein userEmail — sendExportFailedEmail skipped`,
    );
    // skip: missing user-email row; console.warn above provides operator visibility
    return;
  }
  await args.send({
    userId: args.job.userId,
    userEmail,
    tenantId: args.job.requestedFromTenantId,
    jobId: args.job.id,
    errorMessage: args.errorMessage,
  });
}
