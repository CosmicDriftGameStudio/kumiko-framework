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
import { requestDeletionWrite } from "./handlers/request-deletion.write";
import { requestExportWrite } from "./handlers/request-export.write";
import { runForgetCleanupWrite } from "./handlers/run-forget-cleanup.write";
import {
  runExportJobs,
  type SendExportFailedEmailFn,
  type SendExportReadyEmailFn,
} from "./run-export-jobs";
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
   *  Email-Provider. Throw bubbelt → Worker-Run failed in jobRunsTable
   *  → Operator sieht's via /jobs-Dashboard + jobs:write:retry. */
  readonly sendExportReadyEmail?: SendExportReadyEmailFn;
  /** Email-Notification beim Export-failed. Best-effort. */
  readonly sendExportFailedEmail?: SendExportFailedEmailFn;
  /** Base-URL fuer den Magic-Link, z.B.
   *  "https://app.example.com/user-export/by-token". Worker bauen
   *  `${appExportDownloadUrl}?token=<plain>`. Required wenn
   *  sendExportReadyEmail gesetzt. Per-Tenant via reverse-proxy host
   *  routing — nicht via per-Tenant-config-key (App-Author-Decision). */
  readonly appExportDownloadUrl?: string;
};

export function createUserDataRightsFeature(opts: UserDataRightsOptions = {}): FeatureDefinition {
  return defineFeature("user-data-rights", (r) => {
    r.requires("user", "data-retention", "compliance-profiles");
    r.usesApi("compliance.forTenant");
    r.usesApi("retention.policyFor");
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

    // S2.U5a — Endpoints fuer DSGVO Art. 17 Forget-Pfad mit Grace.
    r.writeHandler(requestDeletionWrite);
    r.writeHandler(cancelDeletionWrite);

    // S2.U5b — Cleanup-Runner als privileged-Handler.
    r.writeHandler(runForgetCleanupWrite);
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
          db: ctx.db as import("@cosmicdrift/kumiko-framework/db").DbConnection,
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
    return c.body(errorBody, queryRes.status as 400 | 401 | 404 | 410 | 500, {
      "content-type": queryRes.headers.get("content-type") ?? "application/json",
    });
  }
  const body = (await queryRes.json()) as { data?: { url?: string } };
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
