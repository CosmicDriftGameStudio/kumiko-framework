import {
  createSystemConfig,
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { PRIVACY_CENTER_SCREEN_ID } from "./constants";
import { cancelDeletionWrite } from "./handlers/cancel-deletion.write";
import { createConfirmDeletionByTokenHandler } from "./handlers/confirm-deletion-by-token.write";
import { downloadAttemptListQuery } from "./handlers/download-attempt-list.query";
import { downloadByJobQuery } from "./handlers/download-by-job.query";
import { downloadByTokenQuery } from "./handlers/download-by-token.query";
import { exportJobDetailQuery } from "./handlers/export-job-detail.query";
import { exportJobListQuery } from "./handlers/export-job-list.query";
import { exportStatusQuery } from "./handlers/export-status.query";
import { liftRestrictionWrite } from "./handlers/lift-restriction.write";
import { listDownloadAttemptsQuery } from "./handlers/list-download-attempts.query";
import { myAuditLogQuery } from "./handlers/my-audit-log.query";
import {
  createRequestDeletionHandler,
  type SendDeletionRequestedEmailFn,
} from "./handlers/request-deletion.write";
import {
  createRequestDeletionByEmailHandler,
  type SendDeletionVerificationEmailFn,
} from "./handlers/request-deletion-by-email.write";
import { requestExportWrite } from "./handlers/request-export.write";
import { restrictAccountWrite } from "./handlers/restrict-account.write";
import { createRunForgetCleanupHandler } from "./handlers/run-forget-cleanup.write";
import { USER_DATA_RIGHTS_I18N } from "./i18n";
import {
  type GdprMailDefaults,
  isMailTransportAvailable,
  makeDefaultDeletionExecutedEmail,
  makeDefaultExportFailedEmail,
  makeDefaultExportReadyEmail,
} from "./lib/default-mailers";
import { makeTenantMailTransportResolver } from "./lib/mail-transport-resolver";
import { resolveAppTenantModel } from "./lib/resolve-tenant-model";
import { makeTenantStorageProviderResolver } from "./lib/storage-provider-resolver";
import {
  runExportJobs,
  type SendExportFailedEmailFn,
  type SendExportReadyEmailFn,
} from "./run-export-jobs";
import { runForgetCleanup, type SendDeletionExecutedEmailFn } from "./run-forget-cleanup";
import { downloadAttemptEntity } from "./schema/download-attempt";
import { exportDownloadTokenEntity } from "./schema/download-token";
import { exportJobEntity } from "./schema/export-job";
import { downloadAttemptListScreen, exportJobDetailScreen, exportJobListScreen } from "./screens";

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
  /** Anonymer, email-verifizierter Apex-Deletion-Flow (Lockout-sicher).
   *  HMAC-Secret zum Signieren des Verify-Tokens. Ohne Secret bleibt der
   *  Flow deaktiviert (request-by-email antwortet still success, confirm-
   *  by-token weist generisch ab). */
  readonly deletionTokenSecret?: string;
  /** Basis-URL des Apex-Confirm-Screens, z.B.
   *  "https://app.example.com/delete-account/confirm". Der Handler hängt
   *  `?token=<token>` an. Required wenn deletionTokenSecret gesetzt. */
  readonly deletionVerifyUrl?: string;
  /** Versand des Verify-Magic-Links (Schritt 1 des anonymen Flows).
   *  Best-effort, app-author-wired. MUSS non-blocking sein (enqueue, z.B.
   *  delivery.notify) — ein synchroner Send reintroduziert ein Timing-Oracle
   *  für Account-Enumeration (siehe SendDeletionVerificationEmailFn-Doc).
   *  Bewusst KEINE mail-foundation-Default: ein synchroner Default-Send
   *  brächte genau dieses Enumeration-Oracle zurück, deshalb app-wired. */
  readonly sendDeletionVerificationEmail?: SendDeletionVerificationEmailFn;
  /** C6 — Zero-Callback-GDPR-Mails: ist mail-foundation + ein mail-transport-*
   *  gemountet, versendet user-data-rights die Export-/Loesch-Notifications
   *  selbst (Export-ready/-failed, Deletion-requested/-executed) ueber die
   *  Default-Templates (email-templates.ts) — die App schreibt keinen Callback.
   *  `mailDefaults` brandet diese Default-Mails (Locale + App-Name). Greift NUR
   *  wenn der jeweilige send*Email-Opt NICHT gesetzt ist; Export-ready braucht
   *  zusaetzlich appExportDownloadUrl. */
  readonly mailDefaults?: GdprMailDefaults;
};

export function createUserDataRightsFeature(opts: UserDataRightsOptions = {}): FeatureDefinition {
  // One-shot operator warning (the export cron fires every minute — warn once
  // per process, not every run). Lives in the factory scope so the cron closure
  // shares it across runs.
  let warnedMissingExportUrl = false;
  return defineFeature("user-data-rights", (r) => {
    r.describe(
      'Implements GDPR Art. 15 (access / `my-audit-log` query), Art. 17 (erasure / `request-deletion` + `cancel-deletion`, plus the anonymous email-verified `request-deletion-by-email` + `confirm-deletion-by-token` flow for lockout-safe self-service, + cron cleanup with grace period), Art. 18 (restriction / `restrict-account` + `lift-restriction`), and Art. 20 (portability / async `request-export` \u2192 ZIP via `file-foundation`, Magic-Link download) as first-class HTTP handlers and cron jobs. Each domain feature opts in by calling `r.useExtension(EXT_USER_DATA, "<entity>", { export, delete })` \u2014 the feature then orchestrates the export and forget pipelines across all registered hooks automatically. When `mail-foundation` and a `mail-transport-*` are mounted, it also sends the four GDPR notifications (export ready/failed, deletion requested/executed) itself with no app callback code, rendered in each recipient’s locale. Requires `user`, `data-retention`, `compliance-profiles`, and `sessions`.',
    );
    r.uiHints({
      displayLabel: "User Data Rights \u00b7 GDPR",
      category: "compliance",
      recommended: false,
    });
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

    // App-level tenant-occupancy model. Default "multi-user" → tenant-scoped
    // contributors (e.g. credit) NEVER erase tenant data on a per-user forget
    // (would harm co-members). An app with one user per tenant sets this to
    // "single-user" via appOverrides (TENANT_MODEL_CONFIG_KEY) so the forget
    // pipeline may erase the tenant's data as that user's personal data — still
    // gated by a runtime sole-member check in run-forget-cleanup.
    r.config(
      "tenantModel",
      createSystemConfig("select", {
        default: "multi-user",
        options: ["single-user", "multi-user"],
      }),
    );

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
      createRequestDeletionHandler({
        ...(opts.sendDeletionRequestedEmail && {
          sendDeletionRequestedEmail: opts.sendDeletionRequestedEmail,
        }),
        ...(opts.mailDefaults && { mailDefaults: opts.mailDefaults }),
      }),
    );
    r.writeHandler(cancelDeletionWrite);

    // Anonymer, email-verifizierter Apex-Deletion-Flow (Lockout-sicher):
    // request-by-email (Schritt 1, Magic-Link) + confirm-by-token (Schritt 2,
    // startet dieselbe Grace-Period via startDeletionGracePeriod).
    r.writeHandler(
      createRequestDeletionByEmailHandler({
        ...(opts.deletionTokenSecret !== undefined && {
          deletionTokenSecret: opts.deletionTokenSecret,
        }),
        ...(opts.deletionVerifyUrl !== undefined && { deletionVerifyUrl: opts.deletionVerifyUrl }),
        ...(opts.sendDeletionVerificationEmail !== undefined && {
          sendDeletionVerificationEmail: opts.sendDeletionVerificationEmail,
        }),
      }),
    );
    r.writeHandler(
      createConfirmDeletionByTokenHandler(
        opts.deletionTokenSecret !== undefined
          ? { deletionTokenSecret: opts.deletionTokenSecret }
          : {},
      ),
    );

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

    // Read-only GDPR operator inspector (SystemAdmin) — screens stay inert until an app navs them.
    r.queryHandler(exportJobListQuery);
    r.queryHandler(exportJobDetailQuery);
    r.queryHandler(downloadAttemptListQuery);
    r.screen(exportJobListScreen);
    r.screen(exportJobDetailScreen);
    r.screen(downloadAttemptListScreen);

    r.nav({
      id: "export-job-list",
      label: "user-data-rights:nav.exportJobs",
      icon: "download",
      screen: "user-data-rights:screen:export-job-list",
      order: 25,
      access: { roles: ["SystemAdmin"] },
    });

    r.translations({ keys: USER_DATA_RIGHTS_I18N });

    // Dormant Self-Service-Screen (Art. 15/17/18/20): Export, Aktivitäts-
    // protokoll, Einschränkung, Löschung in einem Screen. Kein r.nav — die
    // App platziert ihn im eingeloggten Bereich. Die React-Component kommt
    // client-seitig aus userDataRightsClient() (web/). access openToAll, weil
    // kein App-Rollenname portabel ist; die per-User-Handler erzwingen Auth
    // server-seitig, und der Screen ist ohne r.nav nirgends sichtbar bis die
    // App ihn aktiv im authed-Bereich verlinkt.
    r.screen({
      id: PRIVACY_CENTER_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: "PrivacyCenterScreen" } },
      access: { openToAll: true },
    });

    // Magic-Link-Pfad (anonymous): GET /user-export/by-token?token=<plain>.
    // Ruft via app.fetch /api/query → success: 302-Redirect zur signed-URL →
    // Browser folgt → Download startet beim Object-Store. Bei error:
    // passthrough (404/410/501) als JSON.
    //
    // Path liegt AUSSERHALB /api/* weil r.httpRoute den /api-namespace nicht
    // claimen darf (reserved fuer write/query/batch/auth/sse-dispatcher).
    //
    // Der Session-Pfad (eingeloggter Download) braucht KEINEN httpRoute-
    // Wrapper: der Client ruft download-by-job direkt via Dispatcher (traegt
    // X-CSRF-Token mit) und navigiert auf die zurueckgegebene signed-URL —
    // siehe postWithDownload im privacy-center-screen.
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
        const exportUserId = ctx._userId ?? SYSTEM_USER_ID;
        const exportDb = ctx.db as import("@cosmicdrift/kumiko-framework/db").DbConnection; // @cast-boundary db-operator
        const exportRegistry = ctx.registry;

        // C6 — ohne eigene send*Email-Opts aber mit gemountetem mail-transport
        // versendet der Cron die Export-Notifications selbst (Default-Templates).
        // Der Resolver baut den per-Tenant-Transport aus configResolver — gleiche
        // Bruecke wie buildStorageProvider.
        const exportMailResolver = isMailTransportAvailable(exportRegistry)
          ? makeTenantMailTransportResolver({
              registry: exportRegistry,
              configResolver: ctx.configResolver,
              secrets: ctx.secrets,
              db: exportDb,
              userId: exportUserId,
              handlerName: "user-data-rights:run-export-jobs",
            })
          : undefined;
        const sendExportReadyEmail =
          opts.sendExportReadyEmail ??
          (exportMailResolver && opts.appExportDownloadUrl !== undefined
            ? makeDefaultExportReadyEmail(exportMailResolver, opts.mailDefaults)
            : undefined);
        const sendExportFailedEmail =
          opts.sendExportFailedEmail ??
          (exportMailResolver
            ? makeDefaultExportFailedEmail(exportMailResolver, opts.mailDefaults)
            : undefined);
        if (
          exportMailResolver &&
          !opts.sendExportReadyEmail &&
          opts.appExportDownloadUrl === undefined &&
          !warnedMissingExportUrl
        ) {
          warnedMissingExportUrl = true;
          // biome-ignore lint/suspicious/noConsole: one-shot operator visibility for misconfig
          console.warn(
            "[user-data-rights:run-export-jobs] mail transport mounted but appExportDownloadUrl unset — default export-ready emails disabled (export-failed + deletion mails still send)",
          );
        }

        await runExportJobs({
          db: exportDb,
          registry: exportRegistry,
          // Per-tenant provider from the mounted file-foundation. The cron
          // context carries configResolver (not the per-request ConfigAccessor),
          // so the resolver builds a per-tenant accessor from it — otherwise
          // createFileProviderForTenant throws and every export lands on failed.
          buildStorageProvider: makeTenantStorageProviderResolver({
            registry: exportRegistry,
            configResolver: ctx.configResolver,
            secrets: ctx.secrets,
            db: exportDb,
            userId: exportUserId,
            handlerName: "user-data-rights:run-export-jobs",
          }),
          now: T.Now.instant(),
          // App-Author-Callbacks haben Vorrang; sonst greift die mail-foundation-
          // Default oben. Beide optional: ohne mail-transport + ohne Callback
          // bleibt es bei Polling via export-status.query.
          ...(sendExportReadyEmail && { sendExportReadyEmail }),
          ...(sendExportFailedEmail && { sendExportFailedEmail }),
          ...(opts.appExportDownloadUrl !== undefined && {
            appExportDownloadUrl: opts.appExportDownloadUrl,
          }),
        });
      },
    );

    // Autonomer Art.17-Forget-Cron. Spiegelt run-export-jobs: nach Ablauf der
    // Grace-Period laeuft runForgetCleanup unbeaufsichtigt (der manuelle
    // userDataRights.runForget-API bleibt fuer Operator-Runs). Ohne diesen
    // Cron bleibt jeder Loesch-Antrag fuer immer in DeletionRequested haengen
    // — Art.17 wuerde nie ausgefuehrt.
    r.job(
      "run-forget-cleanup",
      { trigger: { cron: "0 * * * * *" }, concurrency: "skip" },
      async (_payload, ctx) => {
        if (!ctx.db || !ctx.registry) {
          throw new Error(
            "run-forget-cleanup: ctx.db + ctx.registry required (JobContext incomplete)",
          );
        }
        const T = (await import("@cosmicdrift/kumiko-framework/time")).getTemporal();
        const forgetUserId = ctx._userId ?? SYSTEM_USER_ID;
        const forgetDb = ctx.db as import("@cosmicdrift/kumiko-framework/db").DbConnection; // @cast-boundary db-operator
        const forgetRegistry = ctx.registry;
        const tenantModel = await resolveAppTenantModel({
          registry: forgetRegistry,
          configResolver: ctx.configResolver,
          db: forgetDb,
          userId: forgetUserId,
        });

        // C6 — Default-Mail beim delete-flip wenn kein Callback gesetzt + ein
        // mail-transport gemountet ist (gleiche per-Tenant-Bruecke wie Export).
        const forgetMailResolver = isMailTransportAvailable(forgetRegistry)
          ? makeTenantMailTransportResolver({
              registry: forgetRegistry,
              configResolver: ctx.configResolver,
              secrets: ctx.secrets,
              db: forgetDb,
              userId: forgetUserId,
              handlerName: "user-data-rights:run-forget-cleanup",
            })
          : undefined;
        const sendDeletionExecutedEmail =
          opts.sendDeletionExecutedEmail ??
          (forgetMailResolver
            ? makeDefaultDeletionExecutedEmail(forgetMailResolver, opts.mailDefaults)
            : undefined);

        await runForgetCleanup({
          db: forgetDb,
          registry: forgetRegistry,
          now: T.Now.instant(),
          tenantModel,
          // Same per-tenant provider resolution as the export cron — forget
          // deletes binaries from the store upload + export use.
          buildStorageProvider: makeTenantStorageProviderResolver({
            registry: forgetRegistry,
            configResolver: ctx.configResolver,
            secrets: ctx.secrets,
            db: forgetDb,
            userId: forgetUserId,
            handlerName: "user-data-rights:run-forget-cleanup",
          }),
          ...(sendDeletionExecutedEmail && { sendDeletionExecutedEmail }),
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
