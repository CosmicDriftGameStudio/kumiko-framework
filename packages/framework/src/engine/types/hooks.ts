import type { StoredEvent } from "../../event-store/event-store";
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
  // The event that produced this save. Populated by the event-store-executor;
  // the pipeline uses it to drive projections inside the same transaction.
  // Optional because hand-crafted SaveContexts (tests, custom executors) may
  // not have an event — projections just skip in that case.
  readonly event?: StoredEvent | undefined;
};

export type DeleteContext = {
  readonly kind: "delete";
  readonly id: EntityId;
  readonly data: Readonly<Record<string, unknown>>;
  readonly entityName?: string | undefined;
  // See SaveContext.event — same semantics.
  readonly event?: StoredEvent | undefined;
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
// side-effects that need per-entity semantics (SSE); PostSaveBatch exists
// for adapters that can amortise work across the whole batch (e.g. search
// index batch-writes, bulk webhook fanout).
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
//   the entire write. Use for: DB-based side-effects (counter updates,
//   dependent entity writes).
//
// afterCommit (default): Hook runs after the transaction commits. Failures
//   are logged but don't affect the write. Use for: external systems
//   (SSE broadcast, search index, email, webhooks).

export const HookPhases = {
  inTransaction: "inTransaction",
  afterCommit: "afterCommit",
} as const;

export type HookPhase = (typeof HookPhases)[keyof typeof HookPhases];

// Owner-tag shared across every hook structure. The lifecycle pipeline uses
// it to skip hooks whose owning feature is globally disabled:
//   - A concrete feature name like "orders" → subject to the feature-toggle
//     filter (skipped when "orders" is disabled).
//   - "*" (star) → invariant plumbing, never filtered. Reserved for
//     extension-provided hooks and framework-internal hooks that belong to
//     the pipeline itself, not a feature.
//   - Omitted (undefined) → treated as "*". Supports tests that hand-build
//     HookMap objects without caring about ownership.
export type HookOwner = { readonly featureName?: string };

export type PhasedHook<TFn> = {
  readonly fn: TFn;
  readonly phase: HookPhase;
} & HookOwner;

// Flat (non-phased) hook — preSave, preQuery. Same owner contract, no
// phase semantics because these hooks run exactly once per handler pass
// before/around the DB transaction.
export type OwnedFn<TFn> = {
  readonly fn: TFn;
} & HookOwner;

// --- Hook Maps ---

export type HookMap = {
  readonly validation: Readonly<Record<string, ValidationHookFn>>;
  readonly preSave: Readonly<Record<string, readonly OwnedFn<PreSaveHookFn>[]>>;
  readonly postSave: Readonly<Record<string, readonly PhasedHook<PostSaveHookFn>[]>>;
  readonly preDelete: Readonly<Record<string, readonly PhasedHook<PreDeleteHookFn>[]>>;
  readonly postDelete: Readonly<Record<string, readonly PhasedHook<PostDeleteHookFn>[]>>;
  readonly preQuery: Readonly<Record<string, readonly OwnedFn<PreQueryHookFn>[]>>;
};

export type EntityHookMap = {
  readonly postSave: Readonly<Record<string, readonly PhasedHook<PostSaveHookFn>[]>>;
  readonly preDelete: Readonly<Record<string, readonly PhasedHook<PreDeleteHookFn>[]>>;
  readonly postDelete: Readonly<Record<string, readonly PhasedHook<PostDeleteHookFn>[]>>;
};
