import type { AppContext } from "./handlers";

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
  readonly id: number;
  readonly data: Readonly<Record<string, unknown>>;
  readonly changes: Readonly<Record<string, unknown>>;
  readonly previous: Readonly<Record<string, unknown>>;
  readonly isNew: boolean;
  readonly entityName?: string | undefined;
};

export type DeleteContext = {
  readonly kind: "delete";
  readonly id: number;
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

export type PreDeleteHookFn = (payload: DeleteContext, context: AppContext) => Promise<void>;

export type PostDeleteHookFn = (payload: DeleteContext, context: AppContext) => Promise<void>;

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
