// kumiko-feature-version: 1
//
// inbound-mail-foundation — Plugin host for inbound e-mail
// (inbox federation). Counterpart to mail-foundation (outbound): separate
// extension points, separate state — architectural model is
// file-foundation (the foundation owns state), not mail-transport.
//
// **Multi-provider from day one** (as with billing-foundation): NO global
// `provider` config key. A tenant can connect IMAP and (later) M365/Gmail
// mailboxes in parallel; the provider is specified per MailAccount.
//
// **What this foundation provides:**
//   1. **Plugin API** for inbound providers via r.extendsRegistrar
//      ("inboundMailProvider"): verify/fetch/oauth?/watch? (types.ts).
//   2. **3 event-sourced streams** — mail-account (lifecycle),
//      inbound-message (exactly ONE received event per message, deterministic
//      aggregateId ⇒ exactly-once despite at-least-once ingest),
//      mail-thread (rollup). Full replayable history for later
//      consumers (business processes: ticket, receipt, auto-reply).
//   3. **Inline projections** into read_mail_accounts /
//      read_inbound_messages / read_mail_threads (read-your-own-write).
//   4. **Write/query handlers**: connect/update/disconnect-account,
//      ingest-message (programmatic, SystemAdmin), account:list +
//      message:list (PII-decrypted, scope-filtered).
//   5. **createInboundMailConnectRoutes**: OAuth connect + anonymous
//      callback (outside /api/*), with HMAC-signed state.
//   6. **createInboundMailSupervisor**: app-wired watch (IDLE)
//      supervisor with backoff + reconciliation poll.
//
// **What this foundation does NOT do:**
//   - No business semantics (intent, ticket, assignment, read/
//     completed) — those belong to the app consumer (for example, via an
//     event job on inbound-message-received + its own projection).
//   - No body blob in the event store: the original and attachments go to
//     file-foundation at ingest; the event carries only bodyRef and file ids.
//   - No IMAP flag write-back (V1) — inbox status belongs to the consumer.
//
// **PII/GDPR:** address/from/to/cc/subject/snippet are `personal: "tenant"`
// — encrypted BEFORE every event append (the only write path), event log AND
// projections carry ciphertext; tenant-destroy shreds the subject key
// (crypto-shredding, the same pattern as billing-foundation). The destroy
// hook additionally archives all streams + deletes the rows.

import { defineFeature, EXT_TENANT_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { INBOUND_MAIL_FOUNDATION_FEATURE, INBOUND_MAIL_PROVIDER_EXTENSION } from "./constants.ts";
import {
  inboundMessageEntity,
  mailAccountEntity,
  mailThreadEntity,
  quarantineTable,
  seenMessageTable,
  syncCursorTable,
} from "./entities.ts";
import {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN,
  INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_SHORT,
  INBOUND_MESSAGE_RECEIVED_EVENT_QN,
  INBOUND_MESSAGE_RECEIVED_EVENT_SHORT,
  inboundMessageContentFetchedEventPayloadSchema,
  inboundMessageEventPayloadSchema,
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_ACCOUNT_CONNECTED_EVENT_QN,
  MAIL_ACCOUNT_CONNECTED_EVENT_SHORT,
  MAIL_ACCOUNT_DISCONNECTED_EVENT_QN,
  MAIL_ACCOUNT_DISCONNECTED_EVENT_SHORT,
  MAIL_ACCOUNT_UPDATED_EVENT_QN,
  MAIL_ACCOUNT_UPDATED_EVENT_SHORT,
  MAIL_THREAD_AGGREGATE_TYPE,
  MAIL_THREAD_UPDATED_EVENT_QN,
  MAIL_THREAD_UPDATED_EVENT_SHORT,
  mailAccountEventPayloadSchema,
  mailThreadEventPayloadSchema,
} from "./events.ts";
import { acknowledgeQuarantineHandler } from "./handlers/acknowledge-quarantine.write.ts";
import { attachMessageContentHandler } from "./handlers/attach-message-content.write.ts";
import { connectAccountHandler } from "./handlers/connect-account.write.ts";
import { disconnectAccountHandler } from "./handlers/disconnect-account.write.ts";
import { ingestMessageHandler } from "./handlers/ingest-message.write.ts";
import { listAccountsQuery } from "./handlers/list-accounts.query.ts";
import { listMessagesQuery } from "./handlers/list-messages.query.ts";
import { markCredentialStoredHandler } from "./handlers/mark-credential-stored.write.ts";
import { messageContentQuery } from "./handlers/message-content.query.ts";
import { reactivateAccountHandler } from "./handlers/reactivate-account.write.ts";
import { updateAccountHandler } from "./handlers/update-account.write.ts";
import { INBOUND_MAIL_FOUNDATION_I18N } from "./i18n.ts";
import { registerMailboxProbe } from "./probe.ts";
import {
  applyInboundMessageContentFetched,
  applyInboundMessageReceived,
  applyMailAccountConnected,
  applyMailAccountDisconnected,
  applyMailAccountUpdated,
  applyMailThreadUpdated,
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  mailThreadsProjectionTable,
} from "./projection.ts";
import { registerInboundMailRetentionJob } from "./retention-job.ts";
import { mailAccountEditScreen, mailAccountListScreen } from "./screens.ts";
import {
  INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON,
  inboundMessageTenantDestroyHook,
  mailAccountTenantDestroyHook,
  mailThreadTenantDestroyHook,
} from "./tenant-destroy-hook.ts";
import { registerMailAccountWakeConsumer } from "./wake-consumer.ts";

export function createInboundMailFoundationFeature() {
  return defineFeature(
    INBOUND_MAIL_FOUNDATION_FEATURE,
    (r) => {
      r.adoptsBundledLists();
      r.describe(
        "Plugin host for inbound e-mail (inbox federation) — provider plugins (inbound-provider-imap, later M365 Graph / Gmail REST) register at the `inboundMailProvider` extension point with verify/fetch and optional oauth/watch (live push) and send. `sendMailFromAccount(ctx, { accountId, message })` sends from a connected mailbox through its provider (From = the mailbox address, no fallback to the app sender) and answers typed failures (not configured, login rejected, server unreachable, rejected, invalid message); app write handlers call it, it is no endpoint of its own. The foundation owns three event-sourced streams (mail-account lifecycle, inbound-message with exactly-once ingest via deterministic aggregate ids, mail-thread rollup) and their projections `read_mail_accounts`/`read_inbound_messages`/`read_mail_threads`; PII fields are envelope-encrypted per tenant subject key before every append (crypto-shredding on tenant destroy). Wire `createInboundMailConnectRoutes` (OAuth connect + anonymous callback outside /api) and `createInboundMailSupervisor` (IDLE watch with backoff + reconciliation poll) in bin/server.ts. Consume `inbound-mail-foundation:event:inbound-message-received` from app features to attach business processes.",
      );
      r.uiHints({
        displayLabel: "Inbound Mail · Foundation",
        category: "notifications",
        recommended: false,
      });
      // The EXT_TENANT_DATA hook requires the tenant-lifecycle host.
      r.requires({ features: ["tenant-lifecycle"] });

      // 6 fine-grained domain-events (Payload-Schemas: events.ts).
      // piiFields: "none" — address/subject/snippet are already ciphertext under the tenant subject key before append (see events.ts).
      // "displayName" stays plaintext (often the mailbox owner's real name for
      // personal accounts); encrypting it would break the entity-projection read
      // path that carries it as `personal: false`.
      // v2: lastError, trustedAuthservId. Defaults are shared references across upcast events, so none of them is mutated.
      const mailAccountV2 = {
        piiFields: "none",
        version: 2,
        migrations: [
          {
            fromVersion: 1,
            toVersion: 2,
            transform: { default: { lastError: null, trustedAuthservId: null } },
          },
        ],
      } as const;
      r.defineEvent(
        MAIL_ACCOUNT_CONNECTED_EVENT_SHORT,
        mailAccountEventPayloadSchema,
        mailAccountV2,
      );
      r.defineEvent(MAIL_ACCOUNT_UPDATED_EVENT_SHORT, mailAccountEventPayloadSchema, mailAccountV2);
      r.defineEvent(
        MAIL_ACCOUNT_DISCONNECTED_EVENT_SHORT,
        mailAccountEventPayloadSchema,
        mailAccountV2,
      );
      // v1 mails carry the snippet only: bodyText "" and contentState "snippet" let the content
      // refetch find them.
      r.defineEvent(INBOUND_MESSAGE_RECEIVED_EVENT_SHORT, inboundMessageEventPayloadSchema, {
        piiFields: "none",
        version: 2,
        migrations: [
          {
            fromVersion: 1,
            toVersion: 2,
            transform: {
              default: {
                bodyText: "",
                bodyTextTruncated: false,
                attachmentFileIds: [],
                skippedAttachments: [],
                contentState: "snippet",
                senderAuthentication: null,
              },
            },
          },
        ],
      });
      r.defineEvent(
        INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_SHORT,
        inboundMessageContentFetchedEventPayloadSchema,
        { piiFields: "none" },
      );
      r.defineEvent(MAIL_THREAD_UPDATED_EVENT_SHORT, mailThreadEventPayloadSchema, {
        piiFields: "none",
      });

      // Inline projections — apply in the same transaction as the append.
      r.projection({
        name: "mail-account",
        source: MAIL_ACCOUNT_AGGREGATE_TYPE,
        table: mailAccountsProjectionTable,
        entity: mailAccountEntity,
        apply: {
          [MAIL_ACCOUNT_CONNECTED_EVENT_QN]: applyMailAccountConnected,
          [MAIL_ACCOUNT_UPDATED_EVENT_QN]: applyMailAccountUpdated,
          [MAIL_ACCOUNT_DISCONNECTED_EVENT_QN]: applyMailAccountDisconnected,
        },
      });
      r.projection({
        name: "inbound-message",
        source: INBOUND_MESSAGE_AGGREGATE_TYPE,
        table: inboundMessagesProjectionTable,
        entity: inboundMessageEntity,
        apply: {
          [INBOUND_MESSAGE_RECEIVED_EVENT_QN]: applyInboundMessageReceived,
          [INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN]: applyInboundMessageContentFetched,
        },
      });
      r.projection({
        name: "mail-thread",
        source: MAIL_THREAD_AGGREGATE_TYPE,
        table: mailThreadsProjectionTable,
        entity: mailThreadEntity,
        apply: {
          [MAIL_THREAD_UPDATED_EVENT_QN]: applyMailThreadUpdated,
        },
      });

      registerMailAccountWakeConsumer(r);

      // Plugin extension point — providers register via
      // r.useExtension("inboundMailProvider", "<key>", plugin).
      r.extendsRegistrar(INBOUND_MAIL_PROVIDER_EXTENSION, {
        onRegister: () => {
          // No side-effects at register-time — lookup happens at runtime
          // via resolveInboundProviderForKey/-Account.
        },
      });

      // Sync machinery: high-frequency tick state, deliberately NOT
      // event-sourced — r.storeTable keeps the migration DDL but excludes the
      // tables from the projection rebuild.
      r.storeTable(syncCursorTable, {
        reason: "read_side.mail_sync_cursors_direct_write",
      });
      r.storeTable(seenMessageTable, {
        reason: "read_side.mail_seen_messages_direct_write",
      });

      r.storeTable(quarantineTable, {
        reason: "read_side.mail_quarantine_direct_write",
      });

      // Write-Handler:
      //   - ingest-message: programmatic (Supervisor/Poll, SystemAdmin)
      //   - connect/update/disconnect-account: Lifecycle
      r.writeHandler(ingestMessageHandler);
      r.writeHandler(connectAccountHandler);
      r.writeHandler(updateAccountHandler);
      r.writeHandler(disconnectAccountHandler);
      r.writeHandler(reactivateAccountHandler);
      r.writeHandler(acknowledgeQuarantineHandler);
      r.writeHandler(attachMessageContentHandler);
      r.writeHandler(markCredentialStoredHandler);

      // List-Queries (PII-decrypted, scope-gefiltert).
      r.queryHandler(listAccountsQuery);
      r.queryHandler(listMessagesQuery);
      r.queryHandler(messageContentQuery);

      // Declarative mailbox admin: list (rename, disconnect) and rename form.
      // The app places `mailAccountListScreen` via r.nav in its settings area.
      r.screen(mailAccountListScreen);
      r.screen(mailAccountEditScreen);
      r.translations({ keys: INBOUND_MAIL_FOUNDATION_I18N });
      registerMailboxProbe(r);

      // Entity-specific GDPR destroy hooks — the gdpr-storage boot validator
      // checks the EXT_TENANT_DATA registration for each tenant-subject entity.
      r.useExtension(EXT_TENANT_DATA, "mail-account", {
        destroy: mailAccountTenantDestroyHook,
        escapeHatch: { reason: INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON },
      });
      r.useExtension(EXT_TENANT_DATA, "inbound-message", {
        destroy: inboundMessageTenantDestroyHook,
        escapeHatch: { reason: INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON },
      });
      r.useExtension(EXT_TENANT_DATA, "mail-thread", {
        destroy: mailThreadTenantDestroyHook,
        escapeHatch: { reason: INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON },
      });

      registerInboundMailRetentionJob(r);
    },
    { dedupeOptions: {} },
  );
}
