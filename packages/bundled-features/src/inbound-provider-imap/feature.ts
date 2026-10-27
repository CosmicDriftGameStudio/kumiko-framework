// kumiko-feature-version: 1
//
// inbound-provider-imap — IMAP implementation of the inbound-mail-
// foundation plugin API. Covers the DACH long tail (IONOS, Telekom,
// Strato, GMX/Web.de, mailbox.org, Hetzner, all-inkl) via password/
// app-password authentication, without OAuth. XOAUTH2 is available as
// a fallback for M365/Gmail accounts (access token from the secret slot;
// token refresh is handled by the OAuth providers).
//
// **What this feature provides:**
//   1. Plugin registration via r.useExtension("inboundMailProvider",
//      "imap", { verify, fetch, watch }).
//   2. verify: connect+logout with typed error mapping.
//   3. fetch: incremental sync using a UIDVALIDITY:lastUid cursor —
//      a UIDVALIDITY change throws InboundCursorInvalidError (the
//      foundation resets and resyncs within the backfill window). Initial
//      population uses SEARCH since=backfillWindowDays.
//   4. watch: IMAP IDLE via imapflow — the 'exists' event triggers fetching
//      new UIDs and then onMessages; connection loss triggers onError (the
//      supervisor restarts with backoff; the provider does not reconnect).
//
// Credentials: JSON document in the per-account secret slot
// (credential-document.ts), not tenant configuration, because one tenant
// can have multiple accounts with different hosts.

import { mailAllowedPrivateHostsEnvSchema } from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import {
  assertRolesMatchFoundation,
  INBOUND_MAIL_PROVIDER_EXTENSION,
  type InboundFetchResult,
  type InboundMailContext,
  type InboundMailProviderPlugin,
  type InboundMailRoleOptions,
  type MailAccountRecord,
  type RawInboundMessage,
  resolveInboundMailRoles,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { instantToLegacyDate } from "@cosmicdrift/kumiko-framework/time";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { ImapFlow, MailboxObject } from "imapflow";
import { createConnectMailboxHandler } from "./connect-mailbox.ts";
import { FEATURE_NAME, IMAP_PROVIDER_KEY } from "./constants.ts";
import { readCredentialDocument } from "./credential-document.ts";
import { downloadBatch } from "./download-batch.ts";
import { fetchMessageContent } from "./fetch-content.ts";
import { INBOUND_PROVIDER_IMAP_I18N } from "./i18n.ts";
import {
  assertUidValidity,
  closeOnAbort,
  connectOnce,
  createImapClient,
  IMAP_MAILBOX,
  imapMailHostGuard,
  mapImapError,
  parseImapCursor,
} from "./imap-client.ts";
import { buildProviderMessageId, coerceDate, parseOrReject } from "./parse-message.ts";
import { createReconnectMailboxHandler } from "./reconnect-mailbox.ts";
import { createReconnectPrefillQuery } from "./reconnect-prefill.query.ts";
import {
  createImapConnectScreen,
  createImapReconnectScreen,
  createMyImapReconnectScreen,
} from "./screens.ts";
import { sendFromImapAccount } from "./send-mail.ts";

export { IMAP_PROVIDER_KEY } from "./constants.ts";

export { setImapMailHostLookup } from "./imap-client.ts";

// =============================================================================
// fetch — inkrementeller UID-Sync
// =============================================================================

async function unknownUidsOf(
  uids: readonly number[],
  uidValidity: string,
  filterUnknownMessageIds: (ids: readonly string[]) => Promise<ReadonlySet<string>>,
): Promise<number[]> {
  const unknownIds = await filterUnknownMessageIds(
    uids.map((uid) => buildProviderMessageId(uidValidity, uid)),
  );
  return uids.filter((uid) => unknownIds.has(buildProviderMessageId(uidValidity, uid)));
}

async function fetchMessages(
  ctx: InboundMailContext,
  account: MailAccountRecord,
  cursor: Parameters<InboundMailProviderPlugin["fetch"]>[2],
  opts: {
    readonly backfillWindowDays: number;
    readonly maxMessages: number;
    readonly filterUnknownMessageIds?: (ids: readonly string[]) => Promise<ReadonlySet<string>>;
    readonly signal?: AbortSignal;
  },
): Promise<InboundFetchResult> {
  const doc = await readCredentialDocument(ctx, account);
  const client = await createImapClient(doc, imapMailHostGuard());
  const stopWatchingAbort = closeOnAbort(client, opts.signal);
  let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | undefined;
  try {
    await client.connect();
    lock = await client.getMailboxLock(IMAP_MAILBOX);
    const mailbox = client.mailbox as MailboxObject;
    const serverUidValidity = String(mailbox.uidValidity);
    const parsedCursor = parseImapCursor(cursor);
    assertUidValidity(parsedCursor, serverUidValidity);

    // Determine the UID set: incrementally from lastUid+1, or use a backfill
    // via SEARCH since (the window limits the initial population).
    let uids: number[];
    if (parsedCursor) {
      const found = await client.search({ uid: `${parsedCursor.lastUid + 1}:*` }, { uid: true });
      // `N:*` gotcha: when N exceeds the highest UID, IMAP still returns the
      // last message, so filter it out.
      uids = (found || []).filter((uid) => uid > parsedCursor.lastUid);
    } else {
      const since = Temporal.Now.instant().subtract({ hours: opts.backfillWindowDays * 24 });
      // imapflow API boundary: search() requires a JS Date.
      uids = (await client.search({ since: instantToLegacyDate(since) }, { uid: true })) || [];
    }
    uids.sort((a, b) => a - b);

    // Known mails (ingested or quarantined) are not downloaded again; the cursor still moves past them.
    const unknown = opts.filterUnknownMessageIds
      ? await unknownUidsOf(uids, serverUidValidity, opts.filterUnknownMessageIds)
      : uids;
    const batch = unknown.slice(0, opts.maxMessages);
    const hasMore = unknown.length > batch.length;
    const { messages, rejected } = await downloadBatch(
      client,
      batch,
      serverUidValidity,
      account.trustedAuthservId ?? null,
    );
    // From the UIDs, not from what was downloaded: a known or skipped mail must not hold the cursor back.
    const lastUid = Math.max(parsedCursor?.lastUid ?? 0, ...(hasMore ? batch : uids));

    return {
      messages,
      ...(rejected.length > 0 && { rejected }),
      nextCursor: { uidValidity: serverUidValidity, lastUid },
      hasMore,
    };
  } catch (err) {
    throw err instanceof Error && "kind" in err ? err : mapImapError(err, doc.host);
  } finally {
    stopWatchingAbort();
    lock?.release();
    await client.logout().catch(() => {});
  }
}

// =============================================================================
// watch — IMAP IDLE (imapflow idles automatically while the mailbox is open
// and emits 'exists' for new messages).
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
  const client: ImapFlow = await createImapClient(doc, imapMailHostGuard());
  let stopped = false;

  try {
    await client.connect();
    const mailbox = (await client.mailboxOpen(IMAP_MAILBOX)) as MailboxObject;
    const uidValidity = String(mailbox.uidValidity);
    // uidNext is the next UID to be assigned, so everything from here is
    // "new".
    let nextUid = Number(mailbox.uidNext ?? 1);

    const drainNew = async () => {
      const messages: RawInboundMessage[] = [];
      let maxSeen = nextUid - 1;
      // An unparseable mail is dropped here; the reconciliation poll reports and quarantines it.
      for await (const msg of client.fetch(
        `${nextUid}:*`,
        { uid: true, internalDate: true, source: true },
        { uid: true },
      )) {
        // `N:*` gotcha (see fetch): filter out the previous last message.
        if (msg.uid < nextUid || !msg.source) continue;
        const parsed = await parseOrReject({
          source: msg.source,
          uid: msg.uid,
          uidValidity,
          internalDate: coerceDate(msg.internalDate ?? undefined),
          trustedAuthservId: account.trustedAuthservId ?? null,
        });
        if ("message" in parsed) messages.push(parsed.message);
        if (msg.uid > maxSeen) maxSeen = msg.uid;
      }
      nextUid = maxSeen + 1;
      if (messages.length > 0) await handlers.onMessages(messages);
    };

    client.on("exists", () => {
      // skip: ignore delayed exists events after the watcher has stopped.
      if (stopped) return;
      void drainNew().catch((err) => {
        if (!stopped) handlers.onError(mapImapError(err, doc.host));
      });
    });
    const die = (err: unknown) => {
      // skip: already stopped or terminated; fire onError only once.
      if (stopped) return;
      stopped = true;
      handlers.onError(mapImapError(err, doc.host));
    };
    client.on("error", die);
    client.on("close", () => die(new Error("connection closed")));

    // IDLE loop: 'exists' fires ONLY while client.idle() is running
    // (verified empirically against greenmail). Each intervening command
    // (drainNew-fetch) ends idle(), so the loop re-enters idle() until
    // stop() closes the connection.
    void (async () => {
      while (!stopped) {
        try {
          await client.idle();
        } catch (err) {
          if (!stopped) die(err);
          // skip: the idle loop ends; die() has informed the supervisor (or stop()
          // was the cause).
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

/** Exported for the live test (imap-live.integration.test.ts) —
 *  applications use the feature, never the plugin directly. */
export const imapInboundMailPlugin: InboundMailProviderPlugin = {
  verify: async (ctx, account) => connectOnce(await readCredentialDocument(ctx, account), false),
  probe: async (ctx, account) => connectOnce(await readCredentialDocument(ctx, account), true),
  fetch: fetchMessages,
  fetchContent: fetchMessageContent,
  watch: watchMailbox,
  send: sendFromImapAccount,
  // No oauth block: password authentication runs through the credential
  // form (connect-account + Secret-Write); XOAUTH2 token flows belong to
  // the OAuth providers (M365/Gmail).
};

export function createInboundProviderImapFeature(options: InboundMailRoleOptions = {}) {
  const roles = resolveInboundMailRoles(options);
  return defineFeature(
    FEATURE_NAME,
    (r) => {
      r.describe(
        'Registers the `"imap"` provider for `inbound-mail-foundation` using imapflow — password/app-password auth covers classic IMAP hosts without any OAuth (plus an XOAUTH2 fallback consuming an access token from the secret slot). Incremental sync via a UIDVALIDITY:lastUid cursor (UIDVALIDITY change triggers a cursor-invalid full resync), initial backfill bounded by the foundation backfill window, and live push via IMAP IDLE for the watch supervisor. Tenant admins connect a mailbox through the "Connect mailbox" form on the mail accounts list (`connect-mailbox` checks the IMAP login and the SMTP login of the outgoing server first, then creates the account and its credential secret in one transaction; `reconnect-mailbox` does the same check for an existing mailbox with a sign-in error and overwrites its credential secret); programmatic setups store the per-account connection JSON (host/port/secure/user/password, plus smtpHost/smtpPort for sending) in the account credential secret slot before the first sync. Implements the provider `send`: `sendMailFromAccount` sends over the SMTP server of the mailbox itself (implicit TLS, same login) with the mailbox address as From and stores a copy in its sent folder.',
      );
      r.uiHints({
        displayLabel: "Inbound Mail · IMAP",
        category: "notifications",
        recommended: false,
      });
      r.requires({ features: ["inbound-mail-foundation"] });
      r.requires({ features: ["secrets"] });
      r.envSchema(mailAllowedPrivateHostsEnvSchema);
      r.useExtension(INBOUND_MAIL_PROVIDER_EXTENSION, IMAP_PROVIDER_KEY, imapInboundMailPlugin);
      r.bootCheck(({ features }) => assertRolesMatchFoundation(FEATURE_NAME, roles, features));
      r.writeHandler(createConnectMailboxHandler(roles));
      r.writeHandler(createReconnectMailboxHandler(roles));
      r.queryHandler(createReconnectPrefillQuery(roles));
      r.screen(createImapConnectScreen(roles));
      r.screen(createImapReconnectScreen(roles));
      r.screen(createMyImapReconnectScreen(roles));
      r.translations({ keys: INBOUND_PROVIDER_IMAP_I18N });
    },
    Object.keys(options).length === 0 ? { dedupeOptions: {} } : undefined,
  );
}
