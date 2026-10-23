// kumiko-lint-ignore app-feature-structure feature.ts is over 300 lines and not yet split
import { UNKNOWN_CLIENT_IP } from "@cosmicdrift/kumiko-framework/api";
import {
  createSystemConfig,
  createSystemUser,
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
  i18nKey,
  SYSTEM_USER_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import {
  createMetricsHandle,
  createNoopMetricsHandle,
} from "@cosmicdrift/kumiko-framework/observability";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { createConfigAccessor } from "../config/index.ts";
import { validateGdprHookCompleteness, validateGdprPiiHookCoverage } from "./boot-checks.ts";
import { deletionTokenSecretEnvSchema } from "./env.ts";
import { cancelDeletionWrite } from "./handlers/cancel-deletion.write.ts";
import { createConfirmDeletionByTokenHandler } from "./handlers/confirm-deletion-by-token.write.ts";
import { downloadAttemptListQuery } from "./handlers/download-attempt-list.query.ts";
import { downloadByJobQuery } from "./handlers/download-by-job.query.ts";
import { downloadByTokenQuery } from "./handlers/download-by-token.query.ts";
import { exportJobDetailQuery } from "./handlers/export-job-detail.query.ts";
import { exportJobListQuery } from "./handlers/export-job-list.query.ts";
import { exportStatusQuery } from "./handlers/export-status.query.ts";
import { liftRestrictionWrite } from "./handlers/lift-restriction.write.ts";
import { listDownloadAttemptsQuery } from "./handlers/list-download-attempts.query.ts";
import { myAuditLogQuery } from "./handlers/my-audit-log.query.ts";
import {
  createRequestDeletionHandler,
  type SendDeletionRequestedEmailFn,
} from "./handlers/request-deletion.write.ts";
import {
  createRequestDeletionByEmailHandler,
  type SendDeletionVerificationEmailFn,
} from "./handlers/request-deletion-by-email.write.ts";
import { requestExportWrite } from "./handlers/request-export.write.ts";
import { restrictAccountWrite } from "./handlers/restrict-account.write.ts";
import { createRunForgetCleanupHandler } from "./handlers/run-forget-cleanup.write.ts";
import {
  type GdprMailDefaults,
  isGdprMailDeliveryAvailable,
  isMailRendererAvailable,
  isMailTransportAvailable,
  makeDefaultDeletionExecutedEmail,
  makeDefaultExportFailedEmail,
  makeDefaultExportReadyEmail,
} from "./lib/default-mailers.ts";
import { makeTenantMailTransportResolver } from "./lib/mail-transport-resolver.ts";
import { resolveAppTenantModel } from "./lib/resolve-tenant-model.ts";
import { makeTenantStorageProviderResolver } from "./lib/storage-provider-resolver.ts";
import { registerGdprMails } from "./mail-notifications.ts";
import {
  EXPORT_CLEANUP_BACKLOG_AGE_METRIC,
  EXPORT_CLEANUP_LAST_RUN_TIMESTAMP_METRIC,
  runExportJobs,
  type SendExportFailedEmailFn,
  type SendExportReadyEmailFn,
} from "./run-export-jobs.ts";
import {
  runForgetCleanup,
  type SendDeletionExecutedEmailFn,
  sanitizeReasonForLog,
} from "./run-forget-cleanup.ts";
import { downloadAttemptEntity } from "./schema/download-attempt.ts";
import { exportDownloadTokenEntity } from "./schema/download-token.ts";
import { exportJobEntity } from "./schema/export-job.ts";
import {
  downloadAttemptListScreen,
  exportJobDetailScreen,
  exportJobListScreen,
} from "./screens.ts";
import {
  EXPORT_SECTION_EXTENSION_NAME,
  PRIVACY_CENTER_SCREEN_ID,
  STATUS_OPTION_KEY_PREFIX,
  USER_ME_QUERY,
  UserDataRightsHandlers,
} from "./web/constants.ts";
import { USER_DATA_RIGHTS_I18N } from "./web/i18n.ts";

// user-data-rights — GDPR Articles 15 (access), 17 (erasure),
// 18 (restriction), and 20 (portability) as a core feature.
//
// Instead of making each feature implement its own forget/export logic,
// it registers through `r.useExtension(EXT_USER_DATA, "<entity>", {
// export, delete })`. user-data-rights orchestrates:
//   - Export job: iterates over all extension registrations and collects JSON
//   - Forget job: iterates over all registrations and calls each delete hook
//     with the strategy from `retention.policyFor` (data-retention)
//   - Restriction: flips the user-schema status and enables the auth guard
/**
 * Options for createUserDataRightsFeature. Notification callbacks follow
 * the password-reset pattern in auth-routes.ts.
 *
 * The plain token is never stored in the DB, event store, or jobRunsTable.
 * The worker passes it ephemerally as a callback argument to the app-author
 * implementation (typically `delivery.notify(...)` with `r.notification`
 * templates, `mailFoundation.send` directly, or custom Resend/SES).
 *
 * Worker-run tracking and retries are provided automatically by the existing
 * `jobs` feature.
 */
export type UserDataRightsOptions = {
  /** Email notification when the export completes. The app author connects it
   * to an email provider. Best effort: a send failure for Job A does not stop
   * the batch; remaining pending jobs continue, and the failure is exposed via
   * console.warn. Previously, the error reached the r.job wrapper, so with
   * multiple pending jobs A could commit while B/C/D were never processed and
   * no retry could find them. */
  readonly sendExportReadyEmail?: SendExportReadyEmailFn;
  /** Email-Notification beim Export-failed. Best-effort analog
   *  sendExportReadyEmail. */
  readonly sendExportFailedEmail?: SendExportFailedEmailFn;
  /** Base URL for the magic link, e.g.
   *  "https://app.example.com/user-export/by-token". The worker builds
   *  a URL fragment (`#token=<plain>`). Required when
   *  sendExportReadyEmail is set. Routing uses the reverse-proxy host per
   *  tenant rather than a per-tenant config key. */
  readonly appExportDownloadUrl?: string;
  /** Email notification when deletion is requested ("account deletion in
   *  30 days"). Best effort: a send failure does not abort the status flip
   *  (see handlers/request-deletion.write.ts). */
  readonly sendDeletionRequestedEmail?: SendDeletionRequestedEmailFn;
  /** Email notification after the cleanup runner completes ("account deleted").
   *  Best effort. Delivery occurs after the user hook anonymizes the user, so
   *  the worker caches userEmail+tenantIds before the transaction and passes
   *  them ephemerally to the callback implementation (see
   *  run-forget-cleanup.ts). */
  readonly sendDeletionExecutedEmail?: SendDeletionExecutedEmailFn;
  /** Anonymous, email-verified apex deletion flow that is safe against lockout.
   *  HMAC secret for signing the verification token. Without a secret, the
   *  flow remains disabled: request-by-email returns success silently, while
   *  confirm-by-token rejects generically. */
  readonly deletionTokenSecret?: string;
  /** Base URL of the apex confirmation screen, e.g.
   *  "https://app.example.com/delete-account/confirm". The handler appends
   *  the token as a URL fragment (`#token=<token>`). Required when
   *  deletionTokenSecret is set. */
  readonly deletionVerifyUrl?: string;
  /** Sends the verification magic link (step 1 of the anonymous flow).
   *  Best effort and wired by the app author. It MUST be non-blocking (enqueue,
   *  e.g. via delivery.notify): a synchronous send would reintroduce a timing
   *  oracle for account enumeration (see SendDeletionVerificationEmailFn-doc).
   *  There is deliberately no mail-foundation default because a synchronous
   *  default send would restore that enumeration oracle. */
  readonly sendDeletionVerificationEmail?: SendDeletionVerificationEmailFn;
  /** Zero-callback GDPR mail: when mail-foundation and a mail-transport-* are
   *  mounted, user-data-rights sends export and deletion notifications itself
   *  (export-ready/-failed, deletion-requested/-executed) using the default
   *  templates (email-templates.ts), without an app callback.
   *  `mailDefaults` brands these default messages (locale and app name). It
   *  applies only when the relevant send*Email option is unset; export-ready
   *  also requires appExportDownloadUrl. */
  readonly mailDefaults?: GdprMailDefaults;
  /** Hides the Art. 17 deletion section + its request-deletion/cancel-deletion
   *  actions on the privacy-center screen — for apps that already offer
   *  account deletion elsewhere (e.g. a profile danger-zone), against
   *  duplication. Default `true` (deletion section shown).
   *  BREAKING: replaces the removed client-side
   *  `userDataRightsClient({ privacyCenter: { showDeletion } })` option —
   *  the screen is now declared once, server-side (`type: "projectionDetail"`),
   *  so per-app visibility can only be a boot-time option, not a client-side
   *  component swap. Consumers that passed `showDeletion: false` client-side
   *  must move it here. */
  readonly privacyCenterShowDeletion?: boolean;
};

function isMailTransportMountedWithoutDelivery(features: readonly FeatureDefinition[]): boolean {
  const names = new Set(features.map((feature) => feature.name));
  const hasTransport = [...names].some((name) => name.startsWith("mail-transport-"));
  return (
    names.has("mail-foundation") &&
    hasTransport &&
    !(names.has("delivery") && names.has("channel-email"))
  );
}

export function createUserDataRightsFeature(opts: UserDataRightsOptions = {}): FeatureDefinition {
  // One-shot operator warning (the export cron fires daily — warn once per
  // process, not every run). Lives in the factory scope so the cron closure
  // shares it across runs.
  let warnedMissingExportUrl = false;
  let warnedMissingMailDelivery = false;
  const showDeletion = opts.privacyCenterShowDeletion ?? true;
  return defineFeature("user-data-rights", (r) => {
    r.adoptsBundledLists();
    r.describe(
      'Implements GDPR Art. 15 (access / `my-audit-log` query), Art. 17 (erasure / `request-deletion` + `cancel-deletion`, plus the anonymous email-verified `request-deletion-by-email` + `confirm-deletion-by-token` flow for lockout-safe self-service, + cron cleanup with grace period), Art. 18 (restriction / `restrict-account` + `lift-restriction`), and Art. 20 (portability / async `request-export` \u2192 ZIP via `file-foundation`, Magic-Link download) as first-class HTTP handlers and cron jobs. Each domain feature opts in by calling `r.useExtension(EXT_USER_DATA, "<entity>", { export, delete })` \u2014 the feature then orchestrates the export and forget pipelines across all registered hooks automatically. When `mail-foundation` and a `mail-transport-*` are mounted, it also sends the four GDPR notifications (export ready/failed, deletion requested/executed) itself with no app callback code, rendered in each recipient’s locale. Requires `user`, `data-retention`, `compliance-profiles`, and `sessions`.',
    );
    r.uiHints({
      displayLabel: "User Data Rights \u00b7 GDPR",
      category: "compliance",
      recommended: false,
    });
    r.requires({ features: ["user", "data-retention", "compliance-profiles", "sessions"] });
    r.envSchema(deletionTokenSecretEnvSchema);
    r.usesApi("compliance.forTenant");
    r.usesApi("retention.policyFor");
    // restrict-account calls sessions.revokeAllForUser across features.
    // r.usesApi enables boot validation: without the sessions feature, the app
    // fails at boot instead of raising an opaque "handler not found" error
    // on the first restrict call.
    r.usesApi("sessions.revokeAllForUser");
    // file-foundation is a soft dependency: only the export worker needs it
    // for storage writes. Apps that use only forget (not export) do not need
    // to mount file-foundation.

    r.extendsRegistrar(EXT_USER_DATA, {});

    // GDPR-storage guards V2+V3 — moved off the framework-internal
    // boot-validator onto this feature's own r.bootCheck(), since it's the
    // EXT_USER_DATA channel owner: any r.useExtension(EXT_USER_DATA, ...)
    // usage already requires user-data-rights to be mounted.
    r.bootCheck(({ features }) => validateGdprHookCompleteness(features));
    r.bootCheck(({ features }) => {
      validateGdprPiiHookCoverage(features);
      if (!warnedMissingMailDelivery && isMailTransportMountedWithoutDelivery(features)) {
        warnedMissingMailDelivery = true;
        createFallbackLogger("user-data-rights").warn(
          "mail-foundation and a mail transport are mounted but delivery/channel-email are not — the default export and deletion-request mails need them and will not be sent",
        );
      }
    });

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
        env: "TENANT_MODEL",
      }),
    );

    // ExportJob-Lifecycle-Entity.
    r.entity({ name: "export-job", ...exportJobEntity });

    // The worker generates the token when flipping the job to done (see
    // run-export-jobs.ts). The hash is stored in the database, while the plain
    // token is kept in RunExportJobsResult for email notification.
    r.entity({ name: "export-download-token", ...exportDownloadTokenEntity });

    // Audit-Trail invalid Download-Attempts (DPO Brute-Force-Detection).
    r.entity({ name: "download-attempt", ...downloadAttemptEntity });

    // GDPR Article 18 account freeze (pause processing).
    // The endpoints restrict and lift the restriction. The login block for
    // restricted users lives in auth-email-password/login.write.ts.
    r.writeHandler(restrictAccountWrite);
    r.writeHandler(liftRestrictionWrite);

    // Endpoints for the GDPR Article 17 forget path with a grace period.
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

    // Cleanup runner as a privileged handler. When
    // sendDeletionExecutedEmail is set, the handler passes the callback to
    // runForgetCleanup; the worker caches userEmail+tenantIds before the
    // transaction (see run-forget-cleanup.ts).
    r.writeHandler(
      createRunForgetCleanupHandler(
        opts.sendDeletionExecutedEmail
          ? { sendDeletionExecutedEmail: opts.sendDeletionExecutedEmail }
          : {},
      ),
    );
    r.exposesApi("userDataRights.runForget");

    // User touchpoints for the asynchronous export pipeline.
    r.writeHandler(requestExportWrite);
    r.queryHandler(exportStatusQuery);
    r.exposesApi("userDataRights.runExport");

    // Download endpoints for token and session paths.
    // Both query handlers verify the token or session, obtain a signed URL
    // from the storage provider, and persist audit fields on the token row.
    // The r.httpRoute wrappers below issue the 302 redirect to signedUrl.
    r.queryHandler(downloadByTokenQuery);
    r.queryHandler(downloadByJobQuery);

    // User self-access under Article 15 and operator access to invalid download
    // attempts (DPO).
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
    registerGdprMails(r);
    // Privacy-center dot-form labels (i18nKey()-marked below), duplicated in
    // web/default-translations.ts's client bundle since privacy-center-screen.tsx renders
    // them client-side.
    r.translations({
      keys: {
        "userDataRights.privacyCenter.field.status": { en: "Account status" },
        "userDataRights.privacyCenter.field.gracePeriodEnd": { en: "Scheduled deletion date" },
        "userDataRights.privacyCenter.export.title": { en: "Export your data (Art. 20)" },
        "userDataRights.privacyCenter.restriction.title": { en: "Restrict processing (Art. 18)" },
        "userDataRights.privacyCenter.restriction.explainer": {
          en: "Freeze your account: processing of your data is paused and you are signed out. Lifting the restriction afterwards is only possible via support.",
        },
        "userDataRights.privacyCenter.restriction.restrict": { en: "Restrict account" },
        "userDataRights.privacyCenter.restriction.dialogTitle": { en: "Restrict your account?" },
        "userDataRights.privacyCenter.restriction.dialogDescription": {
          en: "You will be signed out immediately and cannot sign in again until support lifts the restriction.",
        },
        "userDataRights.privacyCenter.deletion.title": { en: "Delete account (Art. 17)" },
        "userDataRights.privacyCenter.deletion.explainer": {
          en: "Request deletion of your account. Until the grace period ends you can cancel the deletion.",
        },
        "userDataRights.privacyCenter.deletion.delete": { en: "Delete account" },
        "userDataRights.privacyCenter.deletion.cancel": { en: "Cancel deletion" },
        "userDataRights.privacyCenter.deletion.dialogTitle": { en: "Delete your account?" },
        "userDataRights.privacyCenter.deletion.dialogDescription": {
          en: "Confirming starts the deletion grace period. You can cancel the deletion until it ends.",
        },
      },
    });

    // Self-service screen (Art. 15/17/18/20): export, restriction, deletion
    // in one projectionDetail screen bound to the user's own `me` row. No
    // r.nav — the app places it in its logged-in area; `dormant: true` opts
    // it out of the nav-area boot check. access is openToAll because no app role name is
    // portable; the per-user handlers enforce auth server-side.
    //
    // Restriction/Deletion are declarative fields + actions; Export stays a
    // custom extension section (web/client-plugin.tsx registers the
    // component under EXPORT_SECTION_EXTENSION_NAME) since it needs
    // async-job polling + a signed-URL download that a declarative action
    // can't express. entityName: "export-job" names the domain entity the
    // extension persists against (projectionDetail has no real entity of
    // its own for the extension to default to).
    r.screen({
      id: PRIVACY_CENTER_SCREEN_ID,
      type: "projectionDetail",
      query: USER_ME_QUERY,
      singleton: true,
      access: {
        openToAll: {
          reason:
            "each signed-in user manages GDPR self-service actions (export, restriction, " +
            "deletion) for only their own account; the bound query and every action handler " +
            "operate on the caller's own userId, and no app role name is portable enough to gate this",
        },
      },
      dormant: true,
      description: showDeletion
        ? "userDataRights.privacyCenter.subtitle"
        : "userDataRights.privacyCenter.subtitleWithoutDeletion",
      fieldLabels: {
        status: i18nKey("userDataRights.privacyCenter.field.status"),
        gracePeriodEnd: i18nKey("userDataRights.privacyCenter.field.gracePeriodEnd"),
      },
      layout: {
        sections: [
          {
            kind: "extension",
            title: i18nKey("userDataRights.privacyCenter.export.title"),
            component: { react: { __component: EXPORT_SECTION_EXTENSION_NAME } },
            entityName: "export-job",
          },
          {
            // `status` lives here (not in Deletion) because this is the one
            // section always on the screen — Deletion is dropped entirely
            // when `showDeletion` is false, and status covers restriction
            // AND deletion state, so it can't hang off the optional section.
            title: i18nKey("userDataRights.privacyCenter.restriction.title"),
            description: i18nKey("userDataRights.privacyCenter.restriction.explainer"),
            fields: [
              {
                field: "status",
                renderer: { format: "enumOption", keyPrefix: STATUS_OPTION_KEY_PREFIX },
              },
            ],
            actions: [
              {
                id: "restrict",
                icon: "lock",
                label: i18nKey("userDataRights.privacyCenter.restriction.restrict"),
                handler: UserDataRightsHandlers.restrictAccount,
                confirm: i18nKey("userDataRights.privacyCenter.restriction.dialogDescription"),
                visible: { field: "status", ne: "restricted" },
                style: "secondary",
              },
            ],
          },
          ...(showDeletion
            ? [
                {
                  title: i18nKey("userDataRights.privacyCenter.deletion.title"),
                  description: i18nKey("userDataRights.privacyCenter.deletion.explainer"),
                  // gracePeriodEnd is only meaningful once a deletion is
                  // actually pending — hide it instead of showing an empty
                  // date when status isn't deletionRequested.
                  fields: [
                    {
                      field: "gracePeriodEnd",
                      renderer: { format: "date" as const },
                      visible: { field: "status", eq: "deletionRequested" },
                    },
                  ],
                  actions: [
                    {
                      id: "request-deletion",
                      label: i18nKey("userDataRights.privacyCenter.deletion.delete"),
                      handler: UserDataRightsHandlers.requestDeletion,
                      confirm: i18nKey("userDataRights.privacyCenter.deletion.dialogDescription"),
                      visible: { field: "status", ne: "deletionRequested" },
                      style: "danger" as const,
                    },
                    {
                      id: "cancel-deletion",
                      label: i18nKey("userDataRights.privacyCenter.deletion.cancel"),
                      handler: UserDataRightsHandlers.cancelDeletion,
                      visible: { field: "status", eq: "deletionRequested" },
                      style: "secondary" as const,
                      // Declared: the id's last segment ("deletion") would otherwise resolve to the destructive trash icon.
                      icon: "x" as const,
                    },
                  ],
                },
              ]
            : []),
        ],
      },
    });

    // Magic-link path (anonymous): the email link carries the token as a
    // URL fragment (`#token=<plain>`) instead of a query param — fragments
    // never leave the browser, so they never hit proxy/access logs
    // This route only serves the interstitial page; the
    // external script reads the fragment client-side and exchanges the
    // token via POST for the signed URL.
    //
    // No `?token=` query fallback: framework is zero-legacy — no
    // live customer data / no emails in flight that would need
    // bridging, so there's nothing a fallback would need to cover. A query
    // param reaches the server as part of the request URL and gets written
    // to proxy/access logs regardless of what the handler does with it
    // afterward (a redirect doesn't undo an already-logged request) — the
    // only leak-proof fix is to never accept the token that way.
    //
    // Path sits outside /api/* — r.httpRoute must not claim the /api namespace
    // (reserved for write/query/batch/auth/sse-dispatcher).
    //
    // The session path (logged-in download) needs no httpRoute wrapper: the
    // client calls download-by-job via the Dispatcher (with X-CSRF-Token) and
    // navigates to the returned signed URL — see postWithDownload in
    // privacy-center-screen.
    r.httpRoute({
      method: "GET",
      path: "/user-export/by-token",
      anonymous: true,
      // Entry point of the emailed download link; cheap static page, but
      // anonymous and token-bearing, so bound per-IP probing.
      rateLimit: { per: "ip+handler", limit: 30, windowSeconds: 60 },
      handler: async (c) => {
        return c.body(TOKEN_EXCHANGE_PAGE_HTML, 200, {
          "content-type": "text/html; charset=utf-8",
        });
      },
    });

    // External script for the interstitial page above — same-origin file
    // instead of inline <script>, so the page also works under a strict
    // `script-src 'self'` CSP (apps set CSP via the security-headers
    // option, without assuming `unsafe-inline`).
    r.httpRoute({
      method: "GET",
      path: "/user-export/by-token.js",
      anonymous: true,
      handler: async (c) => {
        return c.body(TOKEN_EXCHANGE_PAGE_JS, 200, {
          "content-type": "application/javascript; charset=utf-8",
        });
      },
    });

    // Exchange endpoint for the interstitial page: the token arrives here
    // as a POST body instead of a query string. A dedicated
    // route rather than letting the browser JS call /api/query directly,
    // for two reasons:
    //   1. IP/UA audit — extractAuditMeta needs the raw request headers and
    //      the framework-resolved client IP, which only the server has, not
    //      the browser (see the GET path above). Without this route every
    //      fragment-path download would land in download-attempt with
    //      lastUsedFromIp/UA = null.
    //   2. /api/query is the reserved dispatcher namespace for
    //      authenticated writes/queries — an anonymous cross-origin POST
    //      there isn't guaranteed to be reachable (origin guard).
    r.httpRoute({
      method: "POST",
      path: "/user-export/by-token",
      anonymous: true,
      handler: async (c, { app, clientIp }) => {
        const url = new URL(c.req.url);
        const parsedBody = await c.req.json().catch(() => null);
        const token = isPlainObject(parsedBody) ? parsedBody["token"] : undefined;
        if (typeof token !== "string" || token.length === 0) {
          return c.json({ error: "missing_token" }, 400);
        }
        const auditMeta = extractAuditMeta(c.req.raw.headers, clientIp);
        return app.fetch(
          new Request(`${url.origin}/api/query`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              type: "user-data-rights:query:download-by-token",
              payload: { token, auditMeta },
            }),
          }),
          // download-by-token.query.ts's `rateLimit: { per: "ip", limit: 30 }`
          // resolves the client IP from this internal request's env (2nd
          // app.fetch arg), same as Bun.serve's socket address — without it,
          // the resolver has neither a trusted XFF entry (trustedProxyHops
          // defaults to 0, ignoring headers entirely) nor a socket, so every
          // fragment-POST download would fall to the shared "unknown" bucket,
          // turning the per-user 30/min backstop into one global bucket an
          // attacker can exhaust for everyone. Passing `clientIp`
          // directly as env — the same server-resolved, trustedProxyHops-
          // aware value the outer request already trusted — reaches
          // extractSocketAddress() without going through header/hop-count
          // logic at all.
          clientIp,
        );
      },
    });

    // Surfaces a stalled export-cleanup cron: if the daily
    // pass stops running, done-status export bundles keep sitting in
    // storage past their TTL+grace with downloadStorageKey still set
    // (unencrypted PII at rest). Gauges keep their last value in-process, so
    // a dead cron does NOT make the backlog gauge absent; the last-run
    // timestamp gauge below is the liveness signal.
    // Scope: Done-status bundles past expiresAt+grace plus Failed-status
    // orphans (no TTL, due from completedAt ?? startedAt; see storageCleanupPass).
    r.metric(EXPORT_CLEANUP_BACKLOG_AGE_METRIC, {
      type: "gauge",
      unit: "seconds",
      description:
        "Age in seconds of the oldest export bundle (done: expiresAt+grace passed; failed: orphaned ZIP since completedAt or startedAt) whose downloadStorageKey is still set. 0 when the storage-cleanup pass has no backlog.",
    });
    r.metric(EXPORT_CLEANUP_LAST_RUN_TIMESTAMP_METRIC, {
      type: "gauge",
      unit: "seconds",
      description:
        "Unix timestamp of the last export storage-cleanup pass that completed. Alert on time() minus this value exceeding the cron interval plus a buffer; the backlog-age gauge alone stays at its last value when the cron stops.",
    });

    // Worker for the asynchronous export pipeline, triggered by a cron job.
    const RUN_EXPORT_JOBS_REASON = "processes pending export jobs across every tenant";
    r.job({
      name: "run-export-jobs",
      trigger: { cron: "0 3 * * *" },
      concurrency: "skip",
      escapeHatch: { reason: RUN_EXPORT_JOBS_REASON },
      handler: async (_payload, ctx) => {
        if (!ctx.registry) {
          throw new Error("run-export-jobs: ctx.registry required (JobContext incomplete)");
        }
        const T = (await import("@cosmicdrift/kumiko-framework/time")).getTemporal();
        // SYSTEM_USER_ID is the framework-wide convention. The job discriminator is
        // recorded in the secret-read audit through
        // handlerName="user-data-rights:run-export-jobs".
        const exportUserId = SYSTEM_USER_ID;
        const exportDb =
          ctx.db.unsafeRaw() as import("@cosmicdrift/kumiko-framework/db").DbConnection; // @cast-boundary db-operator — jobs never run inside a DbTx
        const exportRegistry = ctx.registry;
        // JobContext carries ctx.meter (raw), not ctx.metrics — that bound
        // handle only exists on HandlerContext (built per write/query call
        // in dispatch-shared.ts). Build the same handle explicitly here.
        const exportMetrics = ctx.meter
          ? createMetricsHandle(ctx.meter, "user-data-rights")
          : createNoopMetricsHandle();

        // Without explicit send*Email options, a mounted mail transport sends the
        // export notifications itself using the default templates. The resolver
        // builds the per-tenant transport from configResolver, bridging it in
        // the same way as buildStorageProvider.
        // The cron runs across tenants, so each mail needs a notify function
        // bound to the recipient's tenant for template overrides and channel
        // configuration.
        const notifyFactory = ctx._notifyFactory;
        const exportNotifyFor =
          notifyFactory !== undefined && isGdprMailDeliveryAvailable(exportRegistry)
            ? (tenantId: TenantId) => notifyFactory(createSystemUser(tenantId), tenantId)
            : undefined;
        const sendExportReadyEmail =
          opts.sendExportReadyEmail ??
          (exportNotifyFor && opts.appExportDownloadUrl !== undefined
            ? makeDefaultExportReadyEmail(exportNotifyFor, opts.mailDefaults)
            : undefined);
        const sendExportFailedEmail =
          opts.sendExportFailedEmail ??
          (exportNotifyFor
            ? makeDefaultExportFailedEmail(exportNotifyFor, opts.mailDefaults)
            : undefined);
        if (
          exportNotifyFor &&
          !opts.sendExportReadyEmail &&
          opts.appExportDownloadUrl === undefined &&
          !warnedMissingExportUrl
        ) {
          warnedMissingExportUrl = true;
          // biome-ignore lint/suspicious/noConsole: one-shot operator visibility for misconfig
          console.warn(
            "[user-data-rights:run-export-jobs] mail delivery mounted but appExportDownloadUrl unset — default export-ready emails disabled (export-failed + deletion mails still send)",
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
          // App-author callbacks take precedence; otherwise the mail-foundation default
          // is used. Both are optional: without a mail transport or callback,
          // clients continue polling via export-status.query.
          ...(sendExportReadyEmail && { sendExportReadyEmail }),
          ...(sendExportFailedEmail && { sendExportFailedEmail }),
          ...(opts.appExportDownloadUrl !== undefined && {
            appExportDownloadUrl: opts.appExportDownloadUrl,
          }),
          escapeHatchAuditSink: ctx._escapeHatchAuditSink,
          escapeHatchAuditLog: ctx.log,
          actor: ctx.systemUser.id,
          metrics: exportMetrics,
        });
      },
    });

    // Automatic Article 17 forget cron. After the grace period, it runs
    // runForgetCleanup without supervision; the manual
    // userDataRights.runForget API remains available for operator runs.
    // Without this cron, deletion requests would remain in
    // DeletionRequested indefinitely and Article 17 erasure would never run.
    const RUN_FORGET_CLEANUP_REASON = "executes overdue Art.17 forget requests across every tenant";
    r.job({
      name: "run-forget-cleanup",
      trigger: { cron: "0 3 * * *" },
      concurrency: "skip",
      escapeHatch: { reason: RUN_FORGET_CLEANUP_REASON },
      handler: async (_payload, ctx) => {
        if (!ctx.registry) {
          throw new Error("run-forget-cleanup: ctx.registry required (JobContext incomplete)");
        }
        const T = (await import("@cosmicdrift/kumiko-framework/time")).getTemporal();
        const forgetUserId = SYSTEM_USER_ID;
        const forgetDb =
          ctx.db.unsafeRaw() as import("@cosmicdrift/kumiko-framework/db").DbConnection; // @cast-boundary db-operator — jobs never run inside a DbTx
        const forgetRegistry = ctx.registry;
        const tenantModel = await resolveAppTenantModel({
          registry: forgetRegistry,
          configResolver: ctx.configResolver,
          db: forgetDb,
          userId: forgetUserId,
        });

        // Without an app callback the default mail goes out when an email channel or a
        // mail transport, plus a mail renderer, are mounted. The user is already erased
        // here, so it bypasses the delivery log: an attempt row would be new personal data.
        const forgetConfigResolver = ctx.configResolver;
        const sendDeletionExecutedEmail =
          opts.sendDeletionExecutedEmail ??
          ((isGdprMailDeliveryAvailable(forgetRegistry) ||
            isMailTransportAvailable(forgetRegistry)) &&
          isMailRendererAvailable(forgetRegistry)
            ? makeDefaultDeletionExecutedEmail(
                {
                  registry: forgetRegistry,
                  db: forgetDb,
                  ...(ctx.secrets !== undefined && { secrets: ctx.secrets }),
                  resolveTransport: makeTenantMailTransportResolver({
                    registry: forgetRegistry,
                    configResolver: forgetConfigResolver,
                    secrets: ctx.secrets,
                    db: forgetDb,
                    userId: forgetUserId,
                    handlerName: "user-data-rights:run-forget-cleanup",
                  }),
                  configFor: (tenantId) =>
                    forgetConfigResolver &&
                    createConfigAccessor(
                      forgetRegistry,
                      forgetConfigResolver,
                      tenantId,
                      forgetUserId,
                      forgetDb,
                    ),
                },
                opts.mailDefaults,
              )
            : undefined);

        const forgetResult = await runForgetCleanup({
          db: forgetDb,
          registry: forgetRegistry,
          now: T.Now.instant(),
          tenantModel,
          ...(ctx.searchAdapter !== undefined && { searchAdapter: ctx.searchAdapter }),
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
          escapeHatchAuditSink: ctx._escapeHatchAuditSink,
          escapeHatchAuditLog: ctx.log,
          actor: ctx.systemUser.id,
        });

        // Persist each incomplete report on the job-run log. The write
        // handler returns incomplete[] in its response; the cron path used to
        // discard the array (only a console.warn for rolledBack cases).
        // ctx.log feeds createJobRunLogger → store_job_run_logs.
        for (const entry of forgetResult.incomplete) {
          ctx.log?.warn?.(
            `[user-data-rights:run-forget-cleanup] incomplete hook ` +
              `userId=${entry.userId} tenantId=${entry.tenantId} ` +
              `entityName=${entry.entityName} rolledBack=${entry.rolledBack} ` +
              `reason=${sanitizeReasonForLog(entry.reason)}`,
          );
        }
      },
    });
  });
}

// `clientIp` comes from the server's trustedProxyHops-aware resolver instead
// of reading X-Forwarded-For here, where a forged first entry would spoof the
// audit IP. A caller hitting /api/query directly (bypassing this httpRoute
// wrapper) with its own auditMeta can still lie — accepted, see
// download-by-token.query.ts.
export function extractAuditMeta(
  headers: Headers,
  clientIp: string,
): { ip: string | null; userAgent: string | null } {
  return {
    ip: clientIp === UNKNOWN_CLIENT_IP ? null : clientIp,
    userAgent: headers.get("user-agent"),
  };
}

// Interstitial page for the magic-link fragment exchange (see the
// httpRoute above). Plain static markup — no build step, no i18n lookup
// (the server doesn't know a user locale here; anonymous path).
const TOKEN_EXCHANGE_PAGE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Export Download</title></head>
<body>
<p id="status">Preparing your download…</p>
<script src="/user-export/by-token.js"></script>
</body>
</html>`;

// Reads the token client-side from the URL fragment (never sent to the
// server) and exchanges it via POST for the signed URL. Same-origin
// external file instead of inline <script>, so the page also works under
// a strict `script-src 'self'` CSP.
const TOKEN_EXCHANGE_PAGE_JS = `(async () => {
  const status = document.getElementById("status");
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("token");
  if (!token) {
    status.textContent = "Invalid download link.";
    return;
  }
  try {
    const res = await fetch("/user-export/by-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await res.json();
    if (!res.ok || !body || !body.data || !body.data.url) {
      status.textContent = "This download link is invalid or has expired.";
      return;
    }
    location.href = body.data.url;
  } catch {
    status.textContent = "Could not start the download.";
  }
})();`;
