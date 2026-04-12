import type { PipelineContext } from "./handlers";

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
  readonly id: number;
  readonly data: Readonly<Record<string, unknown>>;
  readonly changes: Readonly<Record<string, unknown>>;
  readonly previous: Readonly<Record<string, unknown>>;
  readonly isNew: boolean;
  readonly entityName?: string | undefined;
};

export type DeleteContext = {
  readonly id: number;
  readonly data: Readonly<Record<string, unknown>>;
  readonly entityName?: string | undefined;
};

// --- Lifecycle Hooks ---

export type PreSaveHookFn = (
  changes: Record<string, unknown>,
  context: PipelineContext & {
    readonly previous: Readonly<Record<string, unknown>>;
    readonly isNew: boolean;
  },
) => Promise<Record<string, unknown>>;

export type PostSaveHookFn = (result: SaveContext, context: PipelineContext) => Promise<void>;

export type PreDeleteHookFn = (payload: DeleteContext, context: PipelineContext) => Promise<void>;

export type PostDeleteHookFn = (payload: DeleteContext, context: PipelineContext) => Promise<void>;

export type PreQueryHookFn = (
  payload: Record<string, unknown>,
  context: PipelineContext,
) => Promise<Record<string, unknown>>;

export type LifecycleHookFn =
  | PreSaveHookFn
  | PostSaveHookFn
  | PreDeleteHookFn
  | PostDeleteHookFn
  | PreQueryHookFn;

// --- Hook Maps ---

export type HookMap = {
  readonly validation: Readonly<Record<string, ValidationHookFn>>;
  readonly preSave: Readonly<Record<string, readonly PreSaveHookFn[]>>;
  readonly postSave: Readonly<Record<string, readonly PostSaveHookFn[]>>;
  readonly preDelete: Readonly<Record<string, readonly PreDeleteHookFn[]>>;
  readonly postDelete: Readonly<Record<string, readonly PostDeleteHookFn[]>>;
  readonly preQuery: Readonly<Record<string, readonly PreQueryHookFn[]>>;
};

export type EntityHookMap = {
  readonly postSave: Readonly<Record<string, readonly PostSaveHookFn[]>>;
  readonly preDelete: Readonly<Record<string, readonly PreDeleteHookFn[]>>;
  readonly postDelete: Readonly<Record<string, readonly PostDeleteHookFn[]>>;
};
