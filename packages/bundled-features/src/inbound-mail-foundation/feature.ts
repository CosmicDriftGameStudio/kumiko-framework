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
//   - No body blob in the event store: rawMime → file-foundation via
//     the Supervisor-storeBody-Hook; the event carries only bodyRef.
//   - No IMAP flag write-back (V1) — inbox status belongs to the consumer.
//
// **PII/GDPR:** address/from/to/cc/subject/snippet are `personal: "tenant"`
// — encrypted BEFORE every event append (the only write path), event log AND
// projections carry ciphertext; tenant-destroy shreds the subject key
// (crypto-shredding, the same pattern as billing-foundation). The destroy
// hook additionally archives all streams + deletes the rows.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, EXT_TENANT_DATA } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFileProviderForTenant,
  type FileStorageProvider,
} from "@cosmicdrift/kumiko-framework/files";
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
  INBOUND_MESSAGE_RECEIVED_EVENT_QN,
  INBOUND_MESSAGE_RECEIVED_EVENT_SHORT,
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
import { connectAccountHandler } from "./handlers/connect-account.write.ts";
import { disconnectAccountHandler } from "./handlers/disconnect-account.write.ts";
import { ingestMessageHandler } from "./handlers/ingest-message.write.ts";
import { listAccountsQuery } from "./handlers/list-accounts.query.ts";
import { listMessagesQuery } from "./handlers/list-messages.query.ts";
import { updateAccountHandler } from "./handlers/update-account.write.ts";
import { INBOUND_MAIL_FOUNDATION_I18N } from "./i18n.ts";
import {
  applyInboundMessageReceived,
  applyMailAccountConnected,
  applyMailAccountDisconnected,
  applyMailAccountUpdated,
  applyMailThreadUpdated,
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  mailThreadsProjectionTable,
} from "./projection.ts";
import { runInboundMailRetention } from "./retention-sweep.ts";
import { mailAccountEditScreen, mailAccountListScreen } from "./screens.ts";
import {
  INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON,
  inboundMessageTenantDestroyHook,
  mailAccountTenantDestroyHook,
  mailThreadTenantDestroyHook,
} from "./tenant-destroy-hook.ts";

export function createInboundMailFoundationFeature() {
  return defineFeature(
    INBOUND_MAIL_FOUNDATION_FEATURE,
    (r) => {
      r.adoptsBundledLists();
      r.describe(
        "Plugin host for inbound e-mail (inbox federation) — provider plugins (inbound-provider-imap, later M365 Graph / Gmail REST) register at the `inboundMailProvider` extension point with verify/fetch and optional oauth/watch (live push). The foundation owns three event-sourced streams (mail-account lifecycle, inbound-message with exactly-once ingest via deterministic aggregate ids, mail-thread rollup) and their projections `read_mail_accounts`/`read_inbound_messages`/`read_mail_threads`; PII fields are envelope-encrypted per tenant subject key before every append (crypto-shredding on tenant destroy). Wire `createInboundMailConnectRoutes` (OAuth connect + anonymous callback outside /api) and `createInboundMailSupervisor` (IDLE watch with backoff + reconciliation poll) in bin/server.ts. Consume `inbound-mail-foundation:event:inbound-message-received` from app features to attach business processes.",
      );
      r.uiHints({
        displayLabel: "Inbound Mail · Foundation",
        category: "notifications",
        recommended: false,
      });
      // The EXT_TENANT_DATA hook requires the tenant-lifecycle host.
      r.requires({ features: ["tenant-lifecycle"] });

      // 5 fine-grained domain-events (Payload-Schemas: events.ts).
      // piiFields: "none" — address/subject/snippet are already ciphertext under the tenant subject key before append (see events.ts).
      // "displayName" stays plaintext (often the mailbox owner's real name for
      // personal accounts); encrypting it would break the entity-projection read
      // path that carries it as `personal: false`.
      r.defineEvent(MAIL_ACCOUNT_CONNECTED_EVENT_SHORT, mailAccountEventPayloadSchema, {
        piiFields: "none",
      });
      r.defineEvent(MAIL_ACCOUNT_UPDATED_EVENT_SHORT, mailAccountEventPayloadSchema, {
        piiFields: "none",
      });
      r.defineEvent(MAIL_ACCOUNT_DISCONNECTED_EVENT_SHORT, mailAccountEventPayloadSchema, {
        piiFields: "none",
      });
      r.defineEvent(INBOUND_MESSAGE_RECEIVED_EVENT_SHORT, inboundMessageEventPayloadSchema, {
        piiFields: "none",
      });
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

      // Write-Handler:
      //   - ingest-message: programmatic (Supervisor/Poll, SystemAdmin)
      //   - connect/update/disconnect-account: Lifecycle
      r.writeHandler(ingestMessageHandler);
      r.writeHandler(connectAccountHandler);
      r.writeHandler(updateAccountHandler);
      r.writeHandler(disconnectAccountHandler);

      // List-Queries (PII-decrypted, scope-gefiltert).
      r.queryHandler(listAccountsQuery);
      r.queryHandler(listMessagesQuery);

      // Declarative mailbox admin: list (rename, disconnect) and rename form.
      // The app places `mailAccountListScreen` via r.nav in its settings area.
      r.screen(mailAccountListScreen);
      r.screen(mailAccountEditScreen);
      r.translations({ keys: INBOUND_MAIL_FOUNDATION_I18N });

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

      // Data-Retention — perTenant fan-out (one run per tenant, like
      // data-retention:retention-cleanup): runInboundMailRetention's raw query
      // helpers need the unfiltered runner, so the handler declares escapeHatch
      // and reaches for ctx.db.unsafeRaw(). Without this cron, read_inbound_messages
      // + the bodies grow unbounded (GDPR Art. 5).
      const INBOUND_MAIL_RETENTION_REASON =
        "inbound-mail retention runs raw deletes; every statement filters by this run's tenantId";
      r.job({
        name: "inbound-mail-retention",
        trigger: { cron: "0 3 * * *" },
        perTenant: true,
        concurrency: "skip",
        escapeHatch: { reason: INBOUND_MAIL_RETENTION_REASON },
        handler: async (_payload, ctx) => {
          if (!ctx.registry) {
            throw new Error(
              "inbound-mail-retention: ctx.registry required (JobContext incomplete)",
            );
          }
          const tenantId = ctx.systemUser?.tenantId ?? ctx._tenantId;
          if (tenantId === undefined) {
            // skip: cron fired without a perTenant fan-out tenant — nothing scoped
            return;
          }
          const T = (await import("@cosmicdrift/kumiko-framework/time")).getTemporal();
          const retentionDb = ctx.db.unsafeRaw() as DbConnection; // @cast-boundary db-operator — jobs never run inside a DbTx

          // Body objects are stored in file-foundation. The provider is lazy and memoized —
          // ingest currently writes no bodyRef (the storeBody hook is not wired),
          // so the provider is never built. Once storeBody is wired, retention
          // also cleans up the bodies.
          let providerPromise: Promise<FileStorageProvider> | null = null;
          const deleteBodyObject = async (bodyRef: string): Promise<void> => {
            if (!providerPromise) {
              providerPromise = createFileProviderForTenant(
                { config: ctx.config, registry: ctx.registry },
                tenantId,
              );
            }
            const provider = await providerPromise;
            await provider.delete(bodyRef);
          };

          const report = await runInboundMailRetention({
            db: retentionDb,
            tenantId,
            now: T.Now.instant(),
            deleteBodyObject,
          });
          if (report.bodyObjectErrors > 0) {
            // biome-ignore lint/suspicious/noConsole: operator-visibility for failed body deletes
            console.warn(
              `[inbound-mail-foundation:inbound-mail-retention] tenant=${tenantId} bodyObjectErrors=${report.bodyObjectErrors}`,
            );
          }
        },
      });
    },
    { dedupeOptions: {} },
  );
}
