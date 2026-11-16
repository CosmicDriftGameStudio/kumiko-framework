import type { SendDeletionRequestedEmailFn } from "./handlers/request-deletion.write.ts";
import type { SendDeletionVerificationEmailFn } from "./handlers/request-deletion-by-email.write.ts";
import type { GdprMailDefaults } from "./lib/default-mailers.ts";
import type { SendExportFailedEmailFn, SendExportReadyEmailFn } from "./run-export-jobs.ts";
import type { SendDeletionExecutedEmailFn } from "./run-forget-cleanup.ts";

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
  /** Email notification when an export fails. Best-effort like sendExportReadyEmail. */
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
  /** Base URL of the screen that cancels a pending deletion via token, e.g.
   *  "https://app.example.com/delete-account/cancel" (the token is appended as
   *  a URL fragment). Enables the cancel link in the deletion-requested mail;
   *  needs deletionTokenSecret. A requested account cannot sign in, so without
   *  it the user has no way back after closing the session. Use the same route
   *  as the `cancelPath` of makePublicDeletionGate. */
  readonly deletionCancelUrl?: string;
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
