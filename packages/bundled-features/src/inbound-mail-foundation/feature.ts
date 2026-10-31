// kumiko-feature-version: 1
// inbound-mail-foundation: plugin host for inbound e-mail (inbox federation), the counterpart to
// mail-foundation (outbound) with its own extension points and state. Modelled on file-foundation
// (the foundation owns state), not on mail-transport.
//
// **What this foundation provides:**
//   1. **Plugin API** for providers via r.extendsRegistrar: verify/fetch/oauth?/watch? (types.ts).
//   2. **3 event-sourced streams** — mail-account (lifecycle),
//      inbound-message (exactly ONE received event per message, deterministic
//      aggregateId ⇒ exactly-once despite at-least-once ingest),
//      mail-thread (rollup), fully replayable for later consumers.
//   3. **Inline projections** into read_mail_accounts/_inbound_messages/_mail_threads (RYOW).
//   4. **Write/query handlers**: connect/update/disconnect-account,
//      ingest-message (programmatic, SystemAdmin), account:list +
//      message:list (PII-decrypted; personal mail only for its owner).
//
// **Not here:** business semantics (intent, ticket, assignment, read/completed) belong to the app consumer (e.g. an event job on inbound-message-received).
//
// **PII/GDPR:** address/from/to/cc/subject/snippet are `personal: "tenant"`, encrypted BEFORE every
// event append (the only write path), so event log AND projections carry ciphertext; tenant-destroy
// shreds the subject key (crypto-shredding, as in billing-foundation) and its hook additionally
// archives all streams and deletes the rows.

import { defineFeature, EXT_TENANT_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { INBOUND_MAIL_FOUNDATION_FEATURE, INBOUND_MAIL_PROVIDER_EXTENSION } from "./constants.ts";
import {
  inboundMessageEntity,
  mailAccountEntity,
  mailThreadEntity,
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
import { createAcknowledgeQuarantineHandler } from "./handlers/acknowledge-quarantine.write.ts";
import { attachMessageContentHandler } from "./handlers/attach-message-content.write.ts";
import { createConnectAccountHandler } from "./handlers/connect-account.write.ts";
import { createDisconnectAccountHandler } from "./handlers/disconnect-account.write.ts";
import { ingestMessageHandler } from "./handlers/ingest-message.write.ts";
import { createListAccountsQuery } from "./handlers/list-accounts.query.ts";
import { createListMessagesQuery } from "./handlers/list-messages.query.ts";
import { createListQuarantineQuery } from "./handlers/list-quarantine.query.ts";
import { markCredentialStoredHandler } from "./handlers/mark-credential-stored.write.ts";
import { createMessageContentQuery } from "./handlers/message-content.query.ts";
import { createMessageDetailQuery } from "./handlers/message-detail.query.ts";
import { createReactivateAccountHandler } from "./handlers/reactivate-account.write.ts";
import { createRetryQuarantinedMessageHandler } from "./handlers/retry-quarantined-message.write.ts";
import { createSetTrustedAuthservIdHandler } from "./handlers/set-trusted-authserv-id.write.ts";
import { createUpdateAccountHandler } from "./handlers/update-account.write.ts";
import { INBOUND_MAIL_FOUNDATION_I18N } from "./i18n.ts";
import { ingestFailureTable } from "./ingest-failures.ts";
import {
  type InboundMailRoleOptions,
  resolveInboundMailRoles,
  roleDedupeOptions,
} from "./mail-roles.ts";
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
import { quarantineTable } from "./quarantine-entities.ts";
import { createMailQuarantineScreen } from "./quarantine-screens.ts";
import { registerInboundMailRetentionJob } from "./retention-job.ts";
import { createMailAccountScreens } from "./screens.ts";
import {
  INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON,
  inboundMessageTenantDestroyHook,
  mailAccountTenantDestroyHook,
  mailThreadTenantDestroyHook,
} from "./tenant-destroy-hook.ts";
import { registerMailAccountWakeConsumer } from "./wake-consumer.ts";

export function createInboundMailFoundationFeature(options: InboundMailRoleOptions = {}) {
  const roles = resolveInboundMailRoles(options);
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

      // piiFields: "none" — address/subject/snippet are already ciphertext under the tenant subject key before append (see events.ts).
      // "displayName" stays plaintext (often the mailbox owner's real name for
      // personal accounts); encrypting it would break the entity-projection read
      // path that carries it as `personal: false`.
      // v2: lastError, trustedAuthservId. Defaults are shared references across upcast events, so none of them is mutated.
      const mailAccountMigrations = [
        {
          fromVersion: 1,
          toVersion: 2,
          transform: { default: { lastError: null, trustedAuthservId: null } },
        },
      ] as const;
      r.defineEvent(MAIL_ACCOUNT_CONNECTED_EVENT_SHORT, mailAccountEventPayloadSchema, {
        piiFields: "none",
        version: 2,
        migrations: mailAccountMigrations,
      });
      r.defineEvent(MAIL_ACCOUNT_UPDATED_EVENT_SHORT, mailAccountEventPayloadSchema, {
        piiFields: "none",
        version: 2,
        migrations: mailAccountMigrations,
      });
      r.defineEvent(MAIL_ACCOUNT_DISCONNECTED_EVENT_SHORT, mailAccountEventPayloadSchema, {
        piiFields: "none",
        version: 2,
        migrations: mailAccountMigrations,
      });
      // v1 mails carry the snippet only (contentState "snippet" lets the refetch find them); v3 adds the unavailable reason, v4 the sanitized HTML body.
      r.defineEvent(INBOUND_MESSAGE_RECEIVED_EVENT_SHORT, inboundMessageEventPayloadSchema, {
        piiFields: "none",
        version: 4,
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
          {
            fromVersion: 2,
            toVersion: 3,
            transform: { default: { contentUnavailableReason: null } },
          },
          { fromVersion: 3, toVersion: 4, transform: { default: { bodyHtml: null } } },
        ],
      });
      r.defineEvent(
        INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_SHORT,
        inboundMessageContentFetchedEventPayloadSchema,
        {
          piiFields: "none",
          version: 4,
          migrations: [
            {
              fromVersion: 1,
              toVersion: 2,
              transform: { default: { contentUnavailableReason: null } },
            },
            {
              fromVersion: 2,
              toVersion: 3,
              transform: { default: { accountId: null, ownerUserId: null } },
            },
            { fromVersion: 3, toVersion: 4, transform: { default: { bodyHtml: null } } },
          ],
        },
      );
      r.defineEvent(MAIL_THREAD_UPDATED_EVENT_SHORT, mailThreadEventPayloadSchema, {
        piiFields: "none",
      });

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
      // Lookup happens at runtime via resolveInboundProviderForKey/-Account.
      r.extendsRegistrar(INBOUND_MAIL_PROVIDER_EXTENSION, {});

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
      r.storeTable(ingestFailureTable, {
        reason: "read_side.mail_ingest_failures_direct_write",
      });

      // ingest-message is programmatic (supervisor/poll, SystemAdmin); the rest is account lifecycle.
      r.writeHandler(ingestMessageHandler);
      r.writeHandler(createConnectAccountHandler(roles));
      r.writeHandler(createUpdateAccountHandler(roles));
      r.writeHandler(createDisconnectAccountHandler(roles));
      r.writeHandler(createReactivateAccountHandler(roles));
      r.writeHandler(createSetTrustedAuthservIdHandler(roles));
      r.writeHandler(createAcknowledgeQuarantineHandler(roles));
      r.writeHandler(createRetryQuarantinedMessageHandler(roles));
      r.writeHandler(attachMessageContentHandler);
      r.writeHandler(markCredentialStoredHandler);

      r.queryHandler(createListAccountsQuery(roles));
      r.queryHandler(createListMessagesQuery(roles));
      r.queryHandler(createListQuarantineQuery(roles));
      r.queryHandler(createMessageContentQuery(roles));
      r.queryHandler(createMessageDetailQuery(roles));

      // The app places the mailbox lists via r.nav (admins in settings, users next to their connect flow).
      for (const screen of createMailAccountScreens(roles)) r.screen(screen);
      r.screen(createMailQuarantineScreen(roles));
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
      return { roles };
    },
    { dedupeOptions: roleDedupeOptions(roles) },
  );
}
