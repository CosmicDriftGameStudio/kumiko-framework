// kumiko-feature-version: 1
//
// inbound-provider-imap — IMAP-Implementierung der inbound-mail-
// foundation Plugin-API. Deckt den DACH-Long-Tail (IONOS, Telekom,
// Strato, GMX/Web.de, mailbox.org, Hetzner, all-inkl) via Passwort/
// App-Passwort ab — komplett OHNE OAuth. XOAUTH2 als Fallback für
// M365-/Gmail-Konten (Access-Token aus dem Secret-Slot; Token-Refresh
// gehört den OAuth-Providern, Phase 4/5).
//
// **Was diese Feature liefert:**
//   1. Plugin-Registration via r.useExtension("inboundMailProvider",
//      "imap", { verify, fetch, watch }).
//   2. verify: connect+logout mit typisiertem Fehler-Mapping.
//   3. fetch: inkrementeller Sync über UIDVALIDITY:lastUid-Cursor —
//      UIDVALIDITY-Wechsel wirft InboundCursorInvalidError (Foundation
//      resettet + resynct im Backfill-Fenster). Erst-Befüllung via
//      SEARCH since=backfillWindowDays.
//   4. watch: IMAP IDLE via imapflow — 'exists'-Event → neue UIDs
//      fetchen → onMessages; Verbindungs-Tod → onError (Supervisor
//      restartet mit Backoff, der Provider reconnected NICHT selbst).
//
// Credentials: JSON-Dokument im per-Account-Secret-Slot
// (credential-document.ts) — kein Tenant-Config, weil mehrere Accounts
// pro Tenant verschiedene Hosts haben.

import {
  INBOUND_MAIL_PROVIDER_EXTENSION,
  InboundAuthError,
  type InboundFetchResult,
  type InboundMailContext,
  type InboundMailProviderPlugin,
  inboundCredentialSecretKey,
  type MailAccountRecord,
  type RawInboundMessage,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { instantToLegacyDate } from "@cosmicdrift/kumiko-framework/time";
import type { ImapFlow, MailboxObject } from "imapflow";
import { Temporal } from "temporal-polyfill";
import { type ImapCredentialDocument, parseImapCredentialDocument } from "./credential-document";
import {
  assertUidValidity,
  coerceDate,
  createImapClient,
  IMAP_MAILBOX,
  mapImapError,
  parseImapCursor,
  toRawInboundMessage,
} from "./imap-client";

const FEATURE_NAME = "inbound-provider-imap";
export const IMAP_PROVIDER_KEY = "imap";

// =============================================================================
// Credential-Read — per-Account-Slot, Worker-tauglich (slim ctx).
// =============================================================================

async function readCredentialDocument(
  ctx: InboundMailContext,
  account: MailAccountRecord,
): Promise<ImapCredentialDocument> {
  const secrets = requireSecretsContext(ctx, FEATURE_NAME);
  const secret = await secrets.get(account.tenantId, inboundCredentialSecretKey(account.id));
  if (!secret) {
    throw new InboundAuthError(
      `${FEATURE_NAME}: no credential document in secret slot for account ${account.id} — ` +
        `store the IMAP connection JSON under ${inboundCredentialSecretKey(account.id)} first`,
    );
  }
  const parsed = parseImapCredentialDocument(secret.reveal());
  if (!parsed.ok) {
    throw new InboundAuthError(
      `${FEATURE_NAME}: account ${account.id}: ${parsed.reason}${parsed.detail ? `: ${parsed.detail}` : ""}`,
    );
  }
  return parsed.doc;
}

// =============================================================================
// fetch — inkrementeller UID-Sync
// =============================================================================

async function fetchMessages(
  ctx: InboundMailContext,
  account: MailAccountRecord,
  cursor: Parameters<InboundMailProviderPlugin["fetch"]>[2],
  opts: { readonly backfillWindowDays: number; readonly maxMessages: number },
): Promise<InboundFetchResult> {
  const doc = await readCredentialDocument(ctx, account);
  const client = createImapClient(doc);
  try {
    await client.connect();
  } catch (err) {
    throw mapImapError(err, doc.host);
  }

  const lock = await client.getMailboxLock(IMAP_MAILBOX);
  try {
    const mailbox = client.mailbox as MailboxObject;
    const serverUidValidity = String(mailbox.uidValidity);
    const parsedCursor = parseImapCursor(cursor);
    assertUidValidity(parsedCursor, serverUidValidity);

    // UID-Menge bestimmen: inkrementell ab lastUid+1, sonst Backfill
    // über SEARCH since (Fenster begrenzt die Erst-Befüllung).
    let uids: number[];
    if (parsedCursor) {
      const found = await client.search({ uid: `${parsedCursor.lastUid + 1}:*` }, { uid: true });
      // `N:*`-Gotcha: liegt N über der höchsten UID, liefert IMAP
      // trotzdem die letzte Message — rausfiltern.
      uids = (found || []).filter((uid) => uid > parsedCursor.lastUid);
    } else {
      const since = Temporal.Now.instant().subtract({ hours: opts.backfillWindowDays * 24 });
      // imapflow-API-Boundary: search() verlangt ein JS-Date.
      uids = (await client.search({ since: instantToLegacyDate(since) }, { uid: true })) || [];
    }
    uids.sort((a, b) => a - b);

    const batch = uids.slice(0, opts.maxMessages);
    const hasMore = uids.length > batch.length;
    const messages: RawInboundMessage[] = [];
    let maxUid = parsedCursor?.lastUid ?? 0;

    if (batch.length > 0) {
      for await (const msg of client.fetch(
        batch.join(","),
        { uid: true, internalDate: true, source: true },
        { uid: true },
      )) {
        if (!msg.source) continue;
        messages.push(
          await toRawInboundMessage({
            source: msg.source,
            uid: msg.uid,
            uidValidity: serverUidValidity,
            internalDate: coerceDate(msg.internalDate ?? undefined),
          }),
        );
        if (msg.uid > maxUid) maxUid = msg.uid;
      }
    }

    return {
      messages,
      nextCursor: { uidValidity: serverUidValidity, lastUid: maxUid },
      hasMore,
    };
  } catch (err) {
    throw err instanceof Error && "kind" in err ? err : mapImapError(err, doc.host);
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

// =============================================================================
// watch — IMAP IDLE (imapflow idlet automatisch bei offener Mailbox und
// emittet 'exists' bei neuen Messages).
// =============================================================================

async function watchMailbox(
  ctx: InboundMailContext,
  account: MailAccountRecord,
  handlers: {
    readonly onMessages: (msgs: readonly RawInboundMessage[]) => Promise<void>;
    readonly onError: (err: unknown) => void;
  },
): Promise<() => Promise<void>> {
  const doc = await readCredentialDocument(ctx, account);
  const client: ImapFlow = createImapClient(doc);
  let stopped = false;

  try {
    await client.connect();
    const mailbox = (await client.mailboxOpen(IMAP_MAILBOX)) as MailboxObject;
    const uidValidity = String(mailbox.uidValidity);
    // uidNext = nächste zu vergebende UID — alles ab hier ist "neu".
    let nextUid = Number(mailbox.uidNext ?? 1);

    const drainNew = async () => {
      const messages: RawInboundMessage[] = [];
      let maxSeen = nextUid - 1;
      for await (const msg of client.fetch(
        `${nextUid}:*`,
        { uid: true, internalDate: true, source: true },
        { uid: true },
      )) {
        // `N:*`-Gotcha (siehe fetch): alte letzte Message rausfiltern.
        if (msg.uid < nextUid || !msg.source) continue;
        messages.push(
          await toRawInboundMessage({
            source: msg.source,
            uid: msg.uid,
            uidValidity,
            internalDate: coerceDate(msg.internalDate ?? undefined),
          }),
        );
        if (msg.uid > maxSeen) maxSeen = msg.uid;
      }
      nextUid = maxSeen + 1;
      if (messages.length > 0) await handlers.onMessages(messages);
    };

    client.on("exists", () => {
      // skip: Watcher gestoppt — exists-Nachzügler ignorieren.
      if (stopped) return;
      void drainNew().catch((err) => {
        if (!stopped) handlers.onError(mapImapError(err, doc.host));
      });
    });
    const die = (err: unknown) => {
      // skip: bereits gestoppt/gestorben — onError nur einmal feuern.
      if (stopped) return;
      stopped = true;
      handlers.onError(mapImapError(err, doc.host));
    };
    client.on("error", die);
    client.on("close", () => die(new Error("connection closed")));

    // IDLE-Loop: 'exists' feuert NUR während client.idle() läuft
    // (empirisch gegen greenmail verifiziert). Jedes zwischengeschobene
    // Kommando (drainNew-fetch) beendet idle() — die Loop re-idlet,
    // bis stop() die Verbindung schließt.
    void (async () => {
      while (!stopped) {
        try {
          await client.idle();
        } catch (err) {
          if (!stopped) die(err);
          // skip: idle-Loop endet — die() hat den Supervisor informiert (bzw. stop() war die Ursache).
          return;
        }
      }
    })();

    return async () => {
      stopped = true;
      client.removeAllListeners("exists");
      client.removeAllListeners("error");
      client.removeAllListeners("close");
      await client.logout().catch(() => {});
    };
  } catch (err) {
    await client.logout().catch(() => {});
    throw mapImapError(err, doc.host);
  }
}

// =============================================================================
// Plugin + Feature-definition
// =============================================================================

/** Exportiert für den Live-Test (imap-live.integration.test.ts) —
 *  Apps nutzen das Feature, nie das Plugin direkt. */
export const imapInboundMailPlugin: InboundMailProviderPlugin = {
  verify: async (ctx, account) => {
    const doc = await readCredentialDocument(ctx, account);
    const client = createImapClient(doc);
    try {
      await client.connect();
    } catch (err) {
      throw mapImapError(err, doc.host);
    } finally {
      await client.logout().catch(() => {});
    }
  },
  fetch: fetchMessages,
  watch: watchMailbox,
  // Kein oauth-Block: Passwort-Connect läuft über das Credential-
  // Formular (connect-account + Secret-Write); XOAUTH2-Token-Flows
  // gehören den OAuth-Providern (M365/Gmail).
};

export const inboundProviderImapFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    'Registers the `"imap"` provider for `inbound-mail-foundation` using imapflow — password/app-password auth covers classic IMAP hosts without any OAuth (plus an XOAUTH2 fallback consuming an access token from the secret slot). Incremental sync via a UIDVALIDITY:lastUid cursor (UIDVALIDITY change triggers a cursor-invalid full resync), initial backfill bounded by the foundation backfill window, and live push via IMAP IDLE for the watch supervisor. Store the per-account connection JSON (host/port/secure/user/password) in the account credential secret slot before the first sync.',
  );
  r.uiHints({
    displayLabel: "Inbound Mail · IMAP",
    category: "notifications",
    recommended: false,
  });
  r.requires("inbound-mail-foundation");
  r.requires("secrets");
  r.useExtension(INBOUND_MAIL_PROVIDER_EXTENSION, IMAP_PROVIDER_KEY, imapInboundMailPlugin);
});
