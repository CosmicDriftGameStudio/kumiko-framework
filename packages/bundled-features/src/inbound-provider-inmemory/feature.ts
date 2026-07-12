// kumiko-feature-version: 1
//
// inbound-provider-inmemory — scriptbarer In-Memory-Provider für die
// inbound-mail-foundation Plugin-API. Für Tests, Demos und Sample-Apps:
// Messages werden per `seedInboundMessage()` eingespeist statt von einem
// echten Postfach gefetcht; `watch()` pusht geseedete Messages sofort
// (IDLE-Simulation), `fetch()` liefert sie cursor-basiert nach
// (Reconciliation-Pfad) — beide Pfade zusammen exercisen exakt die
// Dedup-Garantie der Foundation.
//
// **Pattern-Vorbild:** mail-transport-inmemory (module-level State +
// Test-Helper-Exports). NICHT für Production.

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
// Module-level State — pro Account: Message-Log (append-only, wie ein
// echtes Postfach), aktive Watch-Handler, One-Shot-Fehlerinjektion.
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

/** Test-Helper: Message ins Postfach legen. Läuft ein watch, wird sie
 *  sofort gepusht (IDLE-Simulation); der nächste fetch liefert sie
 *  cursor-basiert ebenfalls — Dedup der Foundation macht das idempotent. */
export async function seedInboundMessage(accountId: string, msg: RawInboundMessage): Promise<void> {
  const state = stateFor(accountId);
  state.log.push(msg);
  if (state.watch) await state.watch.onMessages([msg]);
}

/** Test-Helper: One-Shot-Fehler für den nächsten fetch (z.B.
 *  InboundAuthError, InboundCursorInvalidError). */
export function failNextFetchWith(accountId: string, err: unknown): void {
  stateFor(accountId).nextFetchError = err;
}

/** Test-Helper: One-Shot-Fehler für das nächste verify. */
export function failNextVerifyWith(accountId: string, err: unknown): void {
  stateFor(accountId).nextVerifyError = err;
}

/** Test-Helper: Tod der Live-Verbindung simulieren (Supervisor muss
 *  mit Backoff neu starten). */
export function emitWatchError(accountId: string, err: unknown): void {
  const state = accounts.get(accountId);
  if (state?.watch) {
    const handlers = state.watch;
    state.watch = null;
    handlers.onError(err);
  }
}

/** Test-Helper: läuft gerade ein watch für den Account? */
export function isWatching(accountId: string): boolean {
  return accounts.get(accountId)?.watch != null;
}

/** Test-Helper: kompletter State-Reset (Test-Isolation — Mock-States
 *  nie zwischen Tests teilen). */
export function resetInboundInMemory(): void {
  accounts.clear();
}

// =============================================================================
// Plugin — cursor = { offset: number } über das append-only-Log.
// =============================================================================

function offsetOf(cursor: SyncCursorPayload | null): number {
  const raw = cursor?.["offset"];
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

const plugin: InboundMailProviderPlugin = {
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

export const inboundProviderInMemoryFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    'Registers a scriptable in-process `"inmemory"` provider for `inbound-mail-foundation`. Seed messages with `seedInboundMessage(accountId, msg)` — an active watch pushes them immediately (IDLE simulation) and the cursor-based `fetch` re-delivers them on the reconciliation path, exercising the foundation dedup guarantee. Error injection via `failNextFetchWith`/`failNextVerifyWith`/`emitWatchError`; reset state with `resetInboundInMemory()`. For tests, demos and sample apps — not for production.',
  );
  r.uiHints({
    displayLabel: "Inbound Mail · In-Memory Provider",
    category: "notifications",
    recommended: false,
  });
  r.requires("inbound-mail-foundation");
  r.useExtension("inboundMailProvider", INMEMORY_PROVIDER_KEY, plugin);
});
