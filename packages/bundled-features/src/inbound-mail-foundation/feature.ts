// kumiko-feature-version: 1
//
// inbound-mail-foundation — Plugin-Host für eingehende E-Mail
// (Inbox-Föderation). Gegenstück zu mail-foundation (outbound): getrennte
// Extension-Points, getrennter State — Architektur-Vorbild ist
// file-foundation (Foundation besitzt State), nicht mail-transport.
//
// **Multi-Provider von Tag 1** (wie billing-foundation): KEIN globaler
// `provider`-config-key. Ein Tenant verbindet parallel IMAP- und (später)
// M365-/Gmail-Postfächer; der Provider steht pro MailAccount.
//
// **Was diese Foundation liefert:**
//   1. **Plugin-API** für Inbound-Provider via r.extendsRegistrar
//      ("inboundMailProvider"): verify/fetch/oauth?/watch? (types.ts).
//   2. **3 event-sourced Streams** — mail-account (Lifecycle),
//      inbound-message (genau EIN received-Event pro Mail, deterministic
//      aggregateId ⇒ exactly-once trotz at-least-once-Ingest),
//      mail-thread (Rollup). Volle Historie replay-fähig für spätere
//      Consumer (Business-Prozesse: Ticket, Beleg, Auto-Antwort).
//   3. **Inline-Projections** auf read_mail_accounts /
//      read_inbound_messages / read_mail_threads (read-your-own-write).
//   4. **Write-/Query-Handler**: connect/update/disconnect-account,
//      ingest-message (programmatic, SystemAdmin), account:list +
//      message:list (PII-decrypted, scope-gefiltert).
//   5. **createInboundMailConnectRoutes**: OAuth-Connect + anonymer
//      Callback (außerhalb /api/*), state HMAC-signiert.
//   6. **createInboundMailSupervisor**: app-verdrahteter Watch-(IDLE)-
//      Supervisor mit Backoff + Reconciliation-Poll.
//
// **Was diese Foundation NICHT macht:**
//   - Keine Business-Semantik (Intent, Ticket, Zuweisung, gelesen/
//     erledigt) — das gehört dem App-Consumer (z.B. via Event-Job auf
//     inbound-message-received + eigener Projection).
//   - Kein Body-Blob im Event-Store: rawMime → file-foundation via
//     Supervisor-storeBody-Hook, Event trägt nur bodyRef.
//   - Kein IMAP-Flag-Write-back (V1) — Inbox-Status lebt beim Consumer.
//
// **PII/DSGVO:** address/from/to/cc/subject/snippet sind tenantOwned —
// encrypted VOR jedem Event-Append (einziger Write-Pfad), Event-Log UND
// Projections tragen Ciphertext; tenant-destroy shreddet den Subject-Key
// (crypto-shredding, Muster billing-foundation #800). Der Destroy-Hook
// archiviert zusätzlich alle Streams + löscht die Rows.

import { defineFeature, EXT_TENANT_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { INBOUND_MAIL_FOUNDATION_FEATURE, INBOUND_MAIL_PROVIDER_EXTENSION } from "./constants";
import {
  inboundMessageEntity,
  mailAccountEntity,
  mailThreadEntity,
  seenMessageTable,
  syncCursorTable,
} from "./entities";
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
} from "./events";
import { connectAccountHandler } from "./handlers/connect-account.write";
import { disconnectAccountHandler } from "./handlers/disconnect-account.write";
import { ingestMessageHandler } from "./handlers/ingest-message.write";
import { listAccountsQuery } from "./handlers/list-accounts.query";
import { listMessagesQuery } from "./handlers/list-messages.query";
import { updateAccountHandler } from "./handlers/update-account.write";
import {
  applyInboundMessageReceived,
  applyMailAccountConnected,
  applyMailAccountDisconnected,
  applyMailAccountUpdated,
  applyMailThreadUpdated,
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  mailThreadsProjectionTable,
} from "./projection";
import { inboundMailTenantDestroyHook } from "./tenant-destroy-hook";

export const inboundMailFoundationFeature = defineFeature(INBOUND_MAIL_FOUNDATION_FEATURE, (r) => {
  r.describe(
    "Plugin host for inbound e-mail (inbox federation) — provider plugins (inbound-provider-imap, later M365 Graph / Gmail REST) register at the `inboundMailProvider` extension point with verify/fetch and optional oauth/watch (live push). The foundation owns three event-sourced streams (mail-account lifecycle, inbound-message with exactly-once ingest via deterministic aggregate ids, mail-thread rollup) and their projections `read_mail_accounts`/`read_inbound_messages`/`read_mail_threads`; PII fields are envelope-encrypted per tenant subject key before every append (crypto-shredding on tenant destroy). Wire `createInboundMailConnectRoutes` (OAuth connect + anonymous callback outside /api) and `createInboundMailSupervisor` (IDLE watch with backoff + reconciliation poll) in bin/server.ts. Consume `inbound-mail-foundation:event:inbound-message-received` from app features to attach business processes.",
  );
  r.uiHints({
    displayLabel: "Inbound Mail · Foundation",
    category: "notifications",
    recommended: false,
  });
  // EXT_TENANT_DATA-Hook braucht den tenant-lifecycle-Host.
  r.requires("tenant-lifecycle");

  // 5 fine-grained domain-events (Payload-Schemas: events.ts).
  r.defineEvent(MAIL_ACCOUNT_CONNECTED_EVENT_SHORT, mailAccountEventPayloadSchema);
  r.defineEvent(MAIL_ACCOUNT_UPDATED_EVENT_SHORT, mailAccountEventPayloadSchema);
  r.defineEvent(MAIL_ACCOUNT_DISCONNECTED_EVENT_SHORT, mailAccountEventPayloadSchema);
  r.defineEvent(INBOUND_MESSAGE_RECEIVED_EVENT_SHORT, inboundMessageEventPayloadSchema);
  r.defineEvent(MAIL_THREAD_UPDATED_EVENT_SHORT, mailThreadEventPayloadSchema);

  // Inline projections — apply in derselben TX wie der Append.
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

  // Plugin extension-point — Provider registrieren sich via
  // r.useExtension("inboundMailProvider", "<key>", plugin).
  r.extendsRegistrar(INBOUND_MAIL_PROVIDER_EXTENSION, {
    onRegister: () => {
      // No side-effects at register-time — Lookup läuft zur Laufzeit
      // über resolveInboundProviderForKey/-Account.
    },
  });

  // Sync-Maschinerie: hochfrequenter Tick-State, bewusst NICHT
  // event-sourced — r.unmanagedTable hält die Migration-DDL, nimmt die
  // Tabellen aber aus dem Projection-Rebuild (#494/#498-Klasse).
  r.unmanagedTable(syncCursorTable, {
    reason: "read_side.mail_sync_cursors_direct_write",
  });
  r.unmanagedTable(seenMessageTable, {
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

  r.useExtension(EXT_TENANT_DATA, "inbound-mail", {
    destroy: inboundMailTenantDestroyHook,
  });
});
