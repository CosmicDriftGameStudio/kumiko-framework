// Dispatcher Contract — the interface every client-side Dispatcher implements.
// Two implementations ship with Kumiko:
//
//   - dispatcher-live: HTTP-only, always online. Writes go straight to
//     /api/write or /api/batch; a failed network call is a failed write.
//     Used on the web by default and on mobile when the app is "cockpit"-
//     style (admin dashboards, back-office UIs).
//
//   - dispatcher-savable: Local-first with an outbound queue. Writes land
//     in a local store, the queue syncs when the network is back. Used on
//     mobile and for PWA-style web apps.
//
// The UI code never reaches for either implementation directly — it takes
// a `Dispatcher` through a provider/context and calls `write` / `query` /
// `batch`. A feature-module can therefore be rendered identically on a
// live-online admin screen and on a mobile app that edits offline; the
// dispatcher choice is an app-level concern, not a feature-level one.
//
// Result shape: `{ isSuccess: true, data } | { isSuccess: false, error }`.
// Pattern matches the server's WriteResult but does not import it — this
// package stays free of @kumiko/framework so it runs in any JS runtime
// (browser, Expo/React Native, Web Worker). The HTTP dispatcher adapts
// the server response to this shape; the savable dispatcher synthesizes
// it from its own state machine. The shape is the boundary, not the
// internal detail.

// ---------------------------------------------------------------------------
// Result envelopes
// ---------------------------------------------------------------------------

// A validation failure issue pinned to a specific payload field. Paths follow
// the same dotted convention the server uses (see kumiko errors/classes.ts),
// so form-controllers can map `tasks.2.title` back to the right sub-line's
// input without any translation.
export type FieldIssue = {
  readonly path: string;
  readonly code: string;
  readonly i18nKey: string;
  readonly params?: Readonly<Record<string, unknown>>;
};

// Everything the UI needs to show or retry a failed call. `code` + `httpStatus`
// are the structured hooks (Toast picks icon/colour, Form-Controller filters
// field-level failures); `message` is the fallback for logs + generic toasts.
// `details.fields` is populated for validation errors — other error classes
// leave it undefined and callers treat the failure as a toast.
export type DispatcherError = {
  readonly code: string;
  readonly httpStatus: number;
  readonly i18nKey: string;
  readonly i18nParams?: Readonly<Record<string, unknown>>;
  readonly message: string;
  readonly details?: {
    readonly fields?: readonly FieldIssue[];
  } & Record<string, unknown>;
  // Server-assigned id for log correlation; missing on client-synthesized
  // errors (network drop, savable-queue rejection before transport).
  readonly requestId?: string;
};

export type WriteResult<TData = unknown> =
  | { readonly isSuccess: true; readonly data: TData }
  | { readonly isSuccess: false; readonly error: DispatcherError };

export type QueryResult<TData = unknown> =
  | { readonly isSuccess: true; readonly data: TData }
  | { readonly isSuccess: false; readonly error: DispatcherError };

// Batch returns an array of per-command results plus the index of the first
// failure (if any). Matches the server's BatchResult so callers can inspect
// partial progress before the rollback in a failed batch.
export type BatchResult =
  | { readonly isSuccess: true; readonly results: readonly WriteResult[] }
  | {
      readonly isSuccess: false;
      readonly error: DispatcherError;
      readonly failedIndex: number;
      readonly results: readonly WriteResult[];
    };

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

// One entry in a batch. `type` is the qualified handler name
// (`feature:write:entity:action`). `payload` is the handler's input — shape
// is declared by the feature author's zod schema on the server, so this
// stays generic here. Nested-write payloads (parent + hasMany children in a
// single object) travel through as-is; the server expands them.
export type Command = {
  readonly type: string;
  readonly payload: unknown;
};

// ---------------------------------------------------------------------------
// Status + pending queues
// ---------------------------------------------------------------------------

// "online"  — transport reachable, writes/queries go through synchronously.
// "offline" — transport unreachable; savable queues, live fails immediately.
// "syncing" — savable's catch-up window after reconnect (queue draining).
//             live-dispatcher never reports "syncing" — nothing to catch up.
export type DispatcherStatus = "online" | "offline" | "syncing";

// What the UI shows as "N changes waiting" badges. Both entries hold enough
// context for a user-facing list ("Task 'Buy milk' – retry? / discard?");
// the dispatcher itself drives the retry/sync — this is read-only for
// rendering.
export type PendingWrite = {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  // Optimistic snapshot of when the user clicked submit, so the UI can show
  // "3 min ago" without reaching for the internal queue's timestamps.
  readonly queuedAt: string;
  readonly attempts: number;
  readonly lastError?: DispatcherError;
};

export type PendingFile = {
  readonly id: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly queuedAt: string;
  readonly attempts: number;
  readonly progress?: number; // 0..1 when uploading; undefined when queued
  readonly lastError?: DispatcherError;
};

// ---------------------------------------------------------------------------
// Call-site options
// ---------------------------------------------------------------------------

export type WriteOpts = {
  // Client-generated idempotency key — server dedupes and returns the
  // cached result on retry. Required for any write a user can trigger
  // twice (double-click submits, connection-retry in savable).
  readonly requestId?: string;
  // Abort handle — the UI cancels a stale submit when the screen changes
  // or the user presses Escape. Live-dispatcher passes this through to
  // fetch; savable-dispatcher removes the entry from its queue.
  readonly signal?: AbortSignal;
};

export type QueryOpts = {
  readonly signal?: AbortSignal;
};

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

// Every client-side dispatcher implements this interface. Hooks
// (`useMutation`, `useCommand`) take it via provider/context; features don't
// know or care which concrete dispatcher they run against. Adding a new
// dispatcher (e.g. a server-sent dispatcher for SSR prefetch) means
// implementing this interface — no changes to feature code.
export type Dispatcher = {
  write<TData = unknown>(
    type: string,
    payload: unknown,
    opts?: WriteOpts,
  ): Promise<WriteResult<TData>>;

  query<TData = unknown>(
    type: string,
    payload: unknown,
    opts?: QueryOpts,
  ): Promise<QueryResult<TData>>;

  batch(commands: readonly Command[], opts?: WriteOpts): Promise<BatchResult>;

  // --- Status ---

  status(): DispatcherStatus;

  // Subscribe/Emit, Pull-Style — listener kriegt keinen Payload, liest den
  // Status frisch via `status()`. Matcht direkt useSyncExternalStore.
  // Returns an unsubscribe function.
  subscribeStatus(listener: () => void): () => void;

  // --- Pending queues (only meaningful for savable; live returns []) ---

  pendingWrites(): readonly PendingWrite[];
  pendingFiles(): readonly PendingFile[];
};
