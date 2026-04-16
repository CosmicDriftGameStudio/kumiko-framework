import type { AppContext } from "./handlers";
import type { EntityId } from "./identifiers";

// --- Validation ---

export type ValidationError = {
  readonly field: string;
  readonly error: string;
};

export type ValidationHookFn = (
  data: Readonly<Record<string, unknown>>,
) => readonly ValidationError[] | null;

// --- Save/Delete Context (what hooks receive) ---

export type SaveContext = {
  readonly kind: "save";
  readonly id: EntityId;
  readonly data: Readonly<Record<string, unknown>>;
  readonly changes: Readonly<Record<string, unknown>>;
  readonly previous: Readonly<Record<string, unknown>>;
  readonly isNew: boolean;
  readonly entityName?: string | undefined;
};

export type DeleteContext = {
  readonly kind: "delete";
  readonly id: EntityId;
  readonly data: Readonly<Record<string, unknown>>;
  readonly entityName?: string | undefined;
};

export type LifecycleResult = SaveContext | DeleteContext;

// --- Lifecycle Hooks ---

export type PreSaveHookFn = (
  changes: Record<string, unknown>,
  context: AppContext & {
    readonly previous: Readonly<Record<string, unknown>>;
    readonly isNew: boolean;
  },
) => Promise<Record<string, unknown>>;

export type PostSaveHookFn = (result: SaveContext, context: AppContext) => Promise<void>;

// Batch-variant: called once at the end of a dispatcher batch with every
// successful SaveContext. The per-save PostSaveHookFn still fires for
// side-effects that need per-entity semantics (SSE, audit); PostSaveBatch
// exists for adapters that can amortise work across the whole batch
// (e.g. search index batch-writes, bulk webhook fanout).
export type PostSaveBatchHookFn = (
  results: readonly SaveContext[],
  context: AppContext,
) => Promise<void>;

export type PreDeleteHookFn = (payload: DeleteContext, context: AppContext) => Promise<void>;

export type PostDeleteHookFn = (payload: DeleteContext, context: AppContext) => Promise<void>;

export type PostDeleteBatchHookFn = (
  payloads: readonly DeleteContext[],
  context: AppContext,
) => Promise<void>;

export type PreQueryHookFn = (
  payload: Record<string, unknown>,
  context: AppContext,
) => Promise<Record<string, unknown>>;

export type LifecycleHookFn =
  | PreSaveHookFn
  | PostSaveHookFn
  | PreDeleteHookFn
  | PostDeleteHookFn
  | PreQueryHookFn;

// --- Hook Phases ---
//
// inTransaction: Hook runs inside the DB transaction. Failures roll back
//   the entire write. Use for: DB-based side-effects (audit rows, counter
//   updates, dependent entity writes).
//
// afterCommit (default): Hook runs after the transaction commits. Failures
//   are logged but don't affect the write. Use for: external systems
//   (SSE broadcast, search index, email, webhooks).

export const HookPhases = {
  inTransaction: "inTransaction",
  afterCommit: "afterCommit",
} as const;

export type HookPhase = (typeof HookPhases)[keyof typeof HookPhases];

export type PhasedHook<TFn> = {
  readonly fn: TFn;
  readonly phase: HookPhase;
};

// --- Hook Maps ---

export type HookMap = {
  readonly validation: Readonly<Record<string, ValidationHookFn>>;
  readonly preSave: Readonly<Record<string, readonly PreSaveHookFn[]>>;
  readonly postSave: Readonly<Record<string, readonly PhasedHook<PostSaveHookFn>[]>>;
  readonly preDelete: Readonly<Record<string, readonly PhasedHook<PreDeleteHookFn>[]>>;
  readonly postDelete: Readonly<Record<string, readonly PhasedHook<PostDeleteHookFn>[]>>;
  readonly preQuery: Readonly<Record<string, readonly PreQueryHookFn[]>>;
};

export type EntityHookMap = {
  readonly postSave: Readonly<Record<string, readonly PhasedHook<PostSaveHookFn>[]>>;
  readonly preDelete: Readonly<Record<string, readonly PhasedHook<PreDeleteHookFn>[]>>;
  readonly postDelete: Readonly<Record<string, readonly PhasedHook<PostDeleteHookFn>[]>>;
};
