// Helpdesk sample
//
// A public website form (question, contact request, problem report) that lands with the
// SystemAdmins: mail, optional Telegram, a copy to the sender. Spam is handled without a
// captcha: honeypot field, single-use proof-of-work challenge, minimum submit time, per-IP
// and per-email rate limits. Rejected submits answer 200 with the normal body.
//
// The website embeds the anonymous client the feature serves itself. The client posts to the
// relative paths /api/query and /api/write, so the page must share its origin with the app
// (or forward /api to it on its own origin):
//   <script src="/helpdesk/client.js"></script>
//   const { kinds, phone } = await window.KumikoHelpdesk.load();
//   const result = await window.KumikoHelpdesk.submit({ kind, name, email, message, locale });
//   // result.kind: "sent" | "rate-limited" (retryAfterSeconds) | "failed"
//
// Prerequisites the app wires itself:
//  - `anonymousAccess` (defaultTenantId = SYSTEM_TENANT_ID) so the form needs no login
//  - delivery with a mail channel (channel-telegram only with `telegram: true`, off by default)
//  - config, user-data-rights and notes-history (required features)
//  - files with a file provider, because the entities carry file fields
//  - `kumiko schema generate` for the new tables

import { createHelpdeskFeature } from "@cosmicdrift/kumiko-bundled-features/helpdesk";

export const helpdeskFeature = createHelpdeskFeature({
  appName: "Sample App",
  fields: { phone: "optional" },
  // Lowered only to keep the sample test fast; the default (19 bits, 3 seconds) suits production.
  spamProtection: { proofOfWorkBits: 8, minSubmitSeconds: 0 },
});
