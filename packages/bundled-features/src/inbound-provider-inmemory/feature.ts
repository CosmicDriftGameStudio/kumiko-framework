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

import type {
  InboundFetchResult,
  InboundMailProviderPlugin,
  MailAccountRecord,
  RawInboundMessage,
  SyncCursorPayload,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
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

type AccountState = {
  readonly log: RawInboundMessage[];
  watch: WatchHandlers | null;
  nextFetchError: unknown;
  nextVerifyError: unknown;
};

const accounts = new Map<string, AccountState>();

function stateFor(accountId: string): AccountState {
  let state = accounts.get(accountId);
  if (!state) {
    state = { log: [], watch: null, nextFetchError: null, nextVerifyError: null };
    accounts.set(accountId, state);
  }
  return state;
}

/** Test helper: adds a message to the mailbox. If a watch is active, it is
 *  pushed immediately (IDLE simulation); the next fetch also returns it by
 *  cursor — the foundation's deduplication makes this idempotent. */
export async function seedInboundMessage(accountId: string, msg: RawInboundMessage): Promise<void> {
  const state = stateFor(accountId);
  state.log.push(msg);
  if (state.watch) await state.watch.onMessages([msg]);
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
  fetch: async (_ctx, account, cursor, opts): Promise<InboundFetchResult> => {
    const state = stateFor(account.id);
    if (state.nextFetchError) {
      const err = state.nextFetchError;
      state.nextFetchError = null;
      throw err;
    }
    const offset = offsetOf(cursor);
    const slice = state.log.slice(offset, offset + opts.maxMessages);
    const nextOffset = offset + slice.length;
    return {
      messages: slice,
      nextCursor: { offset: nextOffset },
      hasMore: nextOffset < state.log.length,
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
