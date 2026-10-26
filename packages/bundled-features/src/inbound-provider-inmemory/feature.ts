// kumiko-feature-version: 1
//
// inbound-provider-inmemory — scriptable in-memory provider for the
// inbound-mail-foundation plugin API. For tests, demos, and sample apps:
// messages are supplied via `seedInboundMessage()` instead of being fetched
// from a real mailbox; `watch()` immediately pushes seeded messages
// (IDLE simulation), while `fetch()` returns them by cursor
// (reconciliation path). Together, both paths exercise the foundation's
// deduplication guarantee exactly.
//
// **Pattern basis:** mail-transport-inmemory (module-level state +
// test-helper exports). Not for production.

import {
  InboundAuthError,
  type InboundContentFetchResult,
  type InboundFetchResult,
  type InboundMailContext,
  type InboundMailProviderPlugin,
  type MailAccountRecord,
  type RawInboundMessage,
  type RejectedInboundMessage,
  type SyncCursorPayload,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const FEATURE_NAME = "inbound-provider-inmemory";
export const INMEMORY_PROVIDER_KEY = "inmemory";

// =============================================================================
// Module-level state — per account: an append-only message log, like a real
// mailbox; active watch handlers and one-shot error injection.
// =============================================================================

type WatchHandlers = {
  readonly onMessages: (msgs: readonly RawInboundMessage[]) => Promise<void>;
  readonly onError: (err: unknown) => void;
};

type LogEntry =
  | { readonly message: RawInboundMessage }
  | { readonly rejected: RejectedInboundMessage };

type AccountState = {
  readonly log: LogEntry[];
  // What fetchContent serves; a message that is not in here counts as gone from the server.
  readonly fullContent: Map<string, RawInboundMessage>;
  readonly contentFetches: string[][];
  watch: WatchHandlers | null;
  nextFetchError: unknown;
  nextVerifyError: unknown;
  hangingFetch: Promise<void> | null;
  lastFetchSignal: AbortSignal | undefined;
  credentialSecretKey: string | null;
};

const accounts = new Map<string, AccountState>();

function stateFor(accountId: string): AccountState {
  let state = accounts.get(accountId);
  if (!state) {
    state = {
      log: [],
      fullContent: new Map(),
      contentFetches: [],
      watch: null,
      nextFetchError: null,
      nextVerifyError: null,
      hangingFetch: null,
      lastFetchSignal: undefined,
      credentialSecretKey: null,
    };
    accounts.set(accountId, state);
  }
  return state;
}

/** Test helper: adds a message to the mailbox. If a watch is active, it is
 *  pushed immediately (IDLE simulation); the next fetch also returns it by
 *  cursor — the foundation's deduplication makes this idempotent. */
export async function seedInboundMessage(accountId: string, msg: RawInboundMessage): Promise<void> {
  const state = stateFor(accountId);
  state.log.push({ message: msg });
  if (state.watch) await state.watch.onMessages([msg]);
}

/** Test helper: a mail the provider cannot parse; fetch reports it as rejected and moves on. */
export function seedRejectedInboundMessage(accountId: string, providerMessageId: string): void {
  stateFor(accountId).log.push({ rejected: { providerMessageId, reason: "unparseable" } });
}

/** Test helper: the full version of a message that fetchContent serves later. */
export function setInboundFullContent(accountId: string, msg: RawInboundMessage): void {
  stateFor(accountId).fullContent.set(msg.providerMessageId, msg);
}

/** Test helper: the provider message ids of every fetchContent call so far. */
export function contentFetchesOf(accountId: string): readonly (readonly string[])[] {
  return stateFor(accountId).contentFetches;
}

/** Test helper: injects a one-shot error into the next fetch (e.g.
 *  InboundAuthError or InboundCursorInvalidError). */
export function failNextFetchWith(accountId: string, err: unknown): void {
  stateFor(accountId).nextFetchError = err;
}

/** Test helper: injects a one-shot error into the next verify. */
export function failNextVerifyWith(accountId: string, err: unknown): void {
  stateFor(accountId).nextVerifyError = err;
}

/** Test helper: fetches of the account do not return until `release()`, whatever the abort signal
 *  says, like a provider that ignores cancellation on a dead connection. */
export function hangFetchesOf(accountId: string): { readonly release: () => void } {
  const state = stateFor(accountId);
  const { promise, resolve } = Promise.withResolvers<void>();
  state.hangingFetch = promise;
  return {
    release: () => {
      state.hangingFetch = null;
      resolve();
    },
  };
}

/** Test helper: the abort signal the last fetch of the account received. */
export function lastFetchSignalOf(accountId: string): AbortSignal | undefined {
  return stateFor(accountId).lastFetchSignal;
}

/** Test helper: every fetch reads this tenant secret first, like a real
 *  provider reads its stored credentials; a missing secret is an auth error. */
export function requireCredentialSecretOnFetch(accountId: string, key: string): void {
  stateFor(accountId).credentialSecretKey = key;
}

async function readCredentialSecret(
  ctx: InboundMailContext,
  account: MailAccountRecord,
  key: string,
): Promise<void> {
  const secrets = requireSecretsContext(
    { secrets: ctx.secrets, auditUserId: ctx.auditUserId },
    FEATURE_NAME,
  );
  const secret = await secrets.get(account.tenantId, key);
  if (!secret) throw new InboundAuthError(`${FEATURE_NAME}: no credential secret ${key}`);
}

/** Test helper: simulates the live connection terminating (the supervisor
 *  must restart with backoff). */
export function emitWatchError(accountId: string, err: unknown): void {
  const state = accounts.get(accountId);
  if (state?.watch) {
    const handlers = state.watch;
    state.watch = null;
    handlers.onError(err);
  }
}

/** Test helper: reports whether an account currently has an active watch. */
export function isWatching(accountId: string): boolean {
  return accounts.get(accountId)?.watch != null;
}

/** Test-Helper: kompletter State-Reset (Test-Isolation — Mock-States
 *  nie zwischen Tests teilen). */
export function resetInboundInMemory(): void {
  accounts.clear();
}

// =============================================================================
// Plugin — cursor = { offset: number } over the append-only log.
// =============================================================================

function offsetOf(cursor: SyncCursorPayload | null): number {
  const raw = cursor?.["offset"];
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

export const inMemoryInboundMailPlugin: InboundMailProviderPlugin = {
  verify: async (_ctx, account: MailAccountRecord) => {
    const state = stateFor(account.id);
    if (state.nextVerifyError) {
      const err = state.nextVerifyError;
      state.nextVerifyError = null;
      throw err;
    }
  },
  fetch: async (ctx, account, cursor, opts): Promise<InboundFetchResult> => {
    const state = stateFor(account.id);
    state.lastFetchSignal = opts.signal;
    if (state.hangingFetch) await state.hangingFetch;
    if (state.nextFetchError) {
      const err = state.nextFetchError;
      state.nextFetchError = null;
      throw err;
    }
    if (state.credentialSecretKey) {
      await readCredentialSecret(ctx, account, state.credentialSecretKey);
    }
    const offset = offsetOf(cursor);
    const slice = state.log.slice(offset, offset + opts.maxMessages);
    const nextOffset = offset + slice.length;
    const rejected = slice.flatMap((entry) => ("rejected" in entry ? [entry.rejected] : []));
    return {
      messages: slice.flatMap((entry) => ("message" in entry ? [entry.message] : [])),
      ...(rejected.length > 0 && { rejected }),
      nextCursor: { offset: nextOffset },
      hasMore: nextOffset < state.log.length,
    };
  },
  fetchContent: async (_ctx, account, providerMessageIds): Promise<InboundContentFetchResult> => {
    const state = stateFor(account.id);
    state.contentFetches.push([...providerMessageIds]);
    const messages = providerMessageIds.flatMap((id) => state.fullContent.get(id) ?? []);
    const found = new Set(messages.map((m) => m.providerMessageId));
    return {
      messages,
      missing: providerMessageIds.filter((id) => !found.has(id)),
      rejected: [],
    };
  },
  watch: async (_ctx, account, handlers) => {
    const state = stateFor(account.id);
    state.watch = handlers;
    return async () => {
      if (state.watch === handlers) state.watch = null;
    };
  },
};

// =============================================================================
// Feature-definition
// =============================================================================
export function createInboundProviderInMemoryFeature() {
  return defineFeature(
    FEATURE_NAME,
    (r) => {
      r.describe(
        'Registers a scriptable in-process `"inmemory"` provider for `inbound-mail-foundation`. Seed messages with `seedInboundMessage(accountId, msg)` — an active watch pushes them immediately (IDLE simulation) and the cursor-based `fetch` re-delivers them on the reconciliation path, exercising the foundation dedup guarantee. Error injection via `failNextFetchWith`/`failNextVerifyWith`/`emitWatchError`; reset state with `resetInboundInMemory()`. For tests, demos and sample apps — not for production.',
      );
      r.uiHints({
        displayLabel: "Inbound Mail · In-Memory Provider",
        category: "notifications",
        recommended: false,
      });
      r.requires({ features: ["inbound-mail-foundation"] });
      r.useExtension("inboundMailProvider", INMEMORY_PROVIDER_KEY, inMemoryInboundMailPlugin);
    },
    { dedupeOptions: {} },
  );
}
