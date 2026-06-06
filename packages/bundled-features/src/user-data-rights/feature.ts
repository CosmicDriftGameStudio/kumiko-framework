import {
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFileProviderForTenant } from "../file-foundation";
import { cancelDeletionWrite } from "./handlers/cancel-deletion.write";
import { downloadByJobQuery } from "./handlers/download-by-job.query";
import { downloadByTokenQuery } from "./handlers/download-by-token.query";
import { exportStatusQuery } from "./handlers/export-status.query";
import { liftRestrictionWrite } from "./handlers/lift-restriction.write";
import { listDownloadAttemptsQuery } from "./handlers/list-download-attempts.query";
import { myAuditLogQuery } from "./handlers/my-audit-log.query";
import {
  createRequestDeletionHandler,
  type SendDeletionRequestedEmailFn,
} from "./handlers/request-deletion.write";
import { requestExportWrite } from "./handlers/request-export.write";
import { restrictAccountWrite } from "./handlers/restrict-account.write";
import { createRunForgetCleanupHandler } from "./handlers/run-forget-cleanup.write";
import {
  runExportJobs,
  type SendExportFailedEmailFn,
  type SendExportReadyEmailFn,
} from "./run-export-jobs";
import type { SendDeletionExecutedEmailFn } from "./run-forget-cleanup";
import { downloadAttemptEntity } from "./schema/download-attempt";
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
/**
 * Options fuer createUserDataRightsFeature. Notification-Callbacks
 * (Atom 5) folgen dem password-reset-Pattern aus auth-routes.ts.
 *
 * Plain-Token landet NIE in DB/event-store/jobRunsTable — Worker reicht
 * ihn ephemeral via Callback-arg an die App-Author-Implementation
 * (typisch: `delivery.notify(...)` mit `r.notification`-Templates,
 * `mailFoundation.send` direkt, oder Custom Resend/SES).
 *
 * Worker-Run-Tracking + Retry kommt automatisch via existing
 * `jobs`-Feature (siehe CLAUDE.md "Bundled-Features by Concern").
 */
export type UserDataRightsOptions = {
  /** Email-Notification beim Export-done. App-Author wired das an seinen
   *  Email-Provider. Best-effort (Atom 5.fix3): send-Throw fuer Job A
   *  killt den Batch nicht — restliche pending-Jobs werden weiter
   *  verarbeitet, Failure wird via console.warn sichtbar. (Vorher
   *  bubbelte der Throw zum r.job-Wrap, was bei mehreren pending Jobs
   *  zum silent-miss fuehrte: Job A done committed, B/C/D nie
   *  verarbeitet, retry findet niemand.) */
  readonly sendExportReadyEmail?: SendExportReadyEmailFn;
  /** Email-Notification beim Export-failed. Best-effort analog
   *  sendExportReadyEmail. */
  readonly sendExportFailedEmail?: SendExportFailedEmailFn;
  /** Base-URL fuer den Magic-Link, z.B.
   *  "https://app.example.com/user-export/by-token". Worker bauen
   *  `${appExportDownloadUrl}?token=<plain>`. Required wenn
   *  sendExportReadyEmail gesetzt. Per-Tenant via reverse-proxy host
   *  routing — nicht via per-Tenant-config-key (App-Author-Decision). */
  readonly appExportDownloadUrl?: string;
  /** Atom 5b — Email-Notification beim deletion-requested-flip
   *  ("Account-Loeschung in 30 Tagen"). Best-effort: send-failure killt
   *  den Status-Flip nicht (siehe handlers/request-deletion.write.ts). */
  readonly sendDeletionRequestedEmail?: SendDeletionRequestedEmailFn;
  /** Atom 5b — Email-Notification beim Cleanup-Runner-done-Pfad
   *  ("Account wurde geloescht"). Best-effort. Der Versand passiert NACH
   *  dem User-Hook-Anonymisieren, deshalb cached der Worker
   *  userEmail+tenantIds PRE-tx und reicht sie ephemeral an die
   *  Callback-Implementation (siehe run-forget-cleanup.ts). */
  readonly sendDeletionExecutedEmail?: SendDeletionExecutedEmailFn;
};

export function createUserDataRightsFeature(opts: UserDataRightsOptions = {}): FeatureDefinition {
  return defineFeature("user-data-rights", (r) => {
    r.describe(
      'Implements GDPR Art. 15 (access / `my-audit-log` query), Art. 17 (erasure / `request-deletion` + `cancel-deletion` + cron cleanup with grace period), Art. 18 (restriction / `restrict-account` + `lift-restriction`), and Art. 20 (portability / async `request-export` \u2192 ZIP via `file-foundation`, Magic-Link download) as first-class HTTP handlers and cron jobs. Each domain feature opts in by calling `r.useExtension(EXT_USER_DATA, "<entity>", { export, delete })` \u2014 the feature then orchestrates the export and forget pipelines across all registered hooks automatically. Requires `user`, `data-retention`, `compliance-profiles`, and `sessions`.',
    );
    r.requires("user", "data-retention", "compliance-profiles", "sessions");
    r.usesApi("compliance.forTenant");
    r.usesApi("retention.policyFor");
    // S2.U6 — restrict-account ruft sessions.revokeAllForUser cross-feature.
    // r.usesApi sorgt fuer Boot-Validation: App ohne sessions-feature wirft
    // beim Boot, statt erst beim ersten Restrict-Call ein opaque "handler
    // not found" zu werfen.
    r.usesApi("sessions.revokeAllForUser");
    // file-foundation ist soft-dep: nur der Export-Worker (Atom 3b)
    // braucht ihn fuer Storage-Schreiben. Apps die nur Forget nutzen
    // (kein Export) muessen file-foundation nicht mounten.

    r.extendsRegistrar(EXT_USER_DATA, {});

    // S2.U3 Atom 1b — ExportJob-Lifecycle-Entity.
    r.entity("export-job", exportJobEntity);

    // S2.U3 Atom 4a — Download-Token-Entity. Worker generiert Token beim
    // Flip auf done (siehe run-export-jobs.ts). Hash in DB, plain im
    // RunExportJobsResult fuer Atom 5 (Notification per Email).
    r.entity("export-download-token", exportDownloadTokenEntity);

    // S2.U7 — Audit-Trail invalid Download-Attempts (DPO Brute-Force-Detection).
    r.entity("download-attempt", downloadAttemptEntity);

    // S2.U6 — DSGVO Art. 18 Account-Freeze (Verarbeitungs-Pause).
    // Endpoints fuer Restrict + Lift. Login-Block fuer Restricted Users
    // lebt in auth-email-password/login.write.ts.
    r.writeHandler(restrictAccountWrite);
    r.writeHandler(liftRestrictionWrite);

    // S2.U5a — Endpoints fuer DSGVO Art. 17 Forget-Pfad mit Grace.
    r.writeHandler(
      createRequestDeletionHandler(
        opts.sendDeletionRequestedEmail
          ? { sendDeletionRequestedEmail: opts.sendDeletionRequestedEmail }
          : {},
      ),
    );
    r.writeHandler(cancelDeletionWrite);

    // S2.U5b — Cleanup-Runner als privileged-Handler. Atom 5b: Wenn
    // sendDeletionExecutedEmail gesetzt, reicht der Handler den Callback
    // an runForgetCleanup weiter (Worker cached userEmail+tenantIds
    // PRE-tx, siehe run-forget-cleanup.ts).
    r.writeHandler(
      createRunForgetCleanupHandler(
        opts.sendDeletionExecutedEmail
          ? { sendDeletionExecutedEmail: opts.sendDeletionExecutedEmail }
          : {},
      ),
    );
    r.exposesApi("userDataRights.runForget");

    // S2.U3 Atom 2 — User-Touchpoints fuer Async Export-Pipeline.
    r.writeHandler(requestExportWrite);
    r.queryHandler(exportStatusQuery);
    r.exposesApi("userDataRights.runExport");

    // S2.U3 Atom 4b — Download-Endpoints (Token-Pfad + Session-Pfad).
    // Beide query-handlers verifizieren Token/Session, holen signed-URL
    // vom Storage-Provider, und persistieren Audit-Felder am Token-Row.
    // r.httpRoute-Wrapper unten machen den 302-Redirect zu signedUrl.
    r.queryHandler(downloadByTokenQuery);
    r.queryHandler(downloadByJobQuery);

    // S2.U7 — User-Selbstauskunft (Art. 15) + Operator-Sicht auf
    // invalid Download-Attempts (DPO).
    r.queryHandler(myAuditLogQuery);
    r.queryHandler(listDownloadAttemptsQuery);

    // r.httpRoute-Wrapper: Magic-Link-Pfad (anonymous) + UI-Klick-Pfad.
    //
    // Beide rufen via app.fetch /api/query → wenn success: 302-Redirect
    // zur signed-URL → Browser folgt → Download startet beim Object-Store.
    // Bei error: passthrough (404/410/501) als JSON.
    //
    // **Token-Pfad (anonymous):** GET /user-export/by-token?token=<plain>
    //
    // Path liegt AUSSERHALB /api/* weil r.httpRoute den /api-namespace
    // nicht claimen darf (reserved fuer write/query/batch/auth/sse-
    // dispatcher).
    r.httpRoute({
      method: "GET",
      path: "/user-export/by-token",
      anonymous: true,
      handler: async (c, { app }) => {
        const url = new URL(c.req.url);
        const token = url.searchParams.get("token");
        if (!token) {
          return c.json({ error: "missing_token" }, 400);
        }
        const queryRes = await app.fetch(
          new Request(`${url.origin}/api/query`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              type: "user-data-rights:query:download-by-token",
              payload: { token, auditMeta: extractAuditMeta(c.req.raw.headers) },
            }),
          }),
        );
        return mapQueryResponseToRedirect(c, queryRes);
      },
    });

    // **Session-Pfad (auth):** GET /user-export/by-job/:jobId
    r.httpRoute({
      method: "GET",
      path: "/user-export/by-job/:jobId",
      handler: async (c, { app }) => {
        const url = new URL(c.req.url);
        const jobId = c.req.param("jobId");
        if (!jobId) {
          return c.json({ error: "missing_job_id" }, 400);
        }
        const queryRes = await app.fetch(
          new Request(`${url.origin}/api/query`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...forwardAuthHeaders(c.req.raw.headers),
            },
            body: JSON.stringify({
              type: "user-data-rights:query:download-by-job",
              payload: { jobId, auditMeta: extractAuditMeta(c.req.raw.headers) },
            }),
          }),
        );
        return mapQueryResponseToRedirect(c, queryRes);
      },
    });

    // S2.U3 Atom 3b — Worker fuer Async Export-Pipeline. Cron-getriggert.
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
        // SYSTEM_USER_ID ist die framework-weite Konvention. Der job-
        // Discriminator wird via handlerName="user-data-rights:run-export-
        // jobs" im Secret-Read-Audit erfasst.
        const providerCtx = {
          config: ctx.config,
          registry: ctx.registry,
          secrets: ctx.secrets,
          _userId: ctx._userId ?? SYSTEM_USER_ID,
        };
        await runExportJobs({
          db: ctx.db as import("@cosmicdrift/kumiko-framework/db").DbConnection, // @cast-boundary db-operator
          registry: ctx.registry,
          buildStorageProvider: async (tenantId) =>
            createFileProviderForTenant(providerCtx, tenantId, "user-data-rights:run-export-jobs"),
          now: T.Now.instant(),
          // Atom 5 — App-Author-Callbacks fuer Email-Notification.
          // Optional: wenn nicht gesetzt, kein Email; User pollt
          // export-status.query + UI-Klick.
          ...(opts.sendExportReadyEmail && {
            sendExportReadyEmail: opts.sendExportReadyEmail,
          }),
          ...(opts.sendExportFailedEmail && {
            sendExportFailedEmail: opts.sendExportFailedEmail,
          }),
          ...(opts.appExportDownloadUrl !== undefined && {
            appExportDownloadUrl: opts.appExportDownloadUrl,
          }),
        });
      },
    );
  });
}

// Map /api/query-Response auf 302-Redirect oder Error-Passthrough.
async function mapQueryResponseToRedirect(
  c: import("hono").Context,
  queryRes: Response,
): Promise<Response> {
  if (!queryRes.ok) {
    const errorBody = await queryRes.text();
    const statusCode = queryRes.status as 400 | 401 | 404 | 410 | 500; // @cast-boundary engine-payload
    return c.body(errorBody, statusCode, {
      "content-type": queryRes.headers.get("content-type") ?? "application/json",
    });
  }
  const body = (await queryRes.json()) as { data?: { url?: string } }; // @cast-boundary engine-payload
  if (!body.data?.url) {
    return c.json({ error: "download_resolution_failed" }, 500);
  }
  return c.redirect(body.data.url, 302);
}

function forwardAuthHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  const auth = headers.get("authorization");
  if (auth) out["authorization"] = auth;
  const cookie = headers.get("cookie");
  if (cookie) out["cookie"] = cookie;
  return out;
}

// Extract Audit-Meta (IP + UA) aus den HTTP-Headers + steck es in die
// query-payload. Der httpRoute-Wrapper ist trusted-source — er hat den
// raw-request gesehen, nicht der direkter /api/query-Caller. User der
// /api/query direkt mit eigenem auditMeta aufruft kann luegen, aber
// auditMeta ist nicht security-relevant (operator kann mit server-logs
// crossreferencen wenn forensik gebraucht).
function extractAuditMeta(headers: Headers): { ip: string | null; userAgent: string | null } {
  const xff = headers.get("x-forwarded-for");
  let ip: string | null = null;
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first && first.length > 0) ip = first;
  }
  if (!ip) {
    const real = headers.get("x-real-ip");
    if (real && real.length > 0) ip = real;
  }
  return { ip, userAgent: headers.get("user-agent") };
}
