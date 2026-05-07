// Step-Vocabulary Types — see docs/plans/architecture/intern/step-vocabulary.md
//
// M.1 minimal scope:
//   - Steps execute against the existing HandlerContext (no per-step subset).
//   - steps-accumulator is Record<string, unknown> (no tuple-reduce typing).
//   - Resolvers receive the full PipelineCtx as one argument.
//
// Strict typing on appendEvent inside steps is deferred to a later pass
// (see TS-typing notes in the design doc). M.1 uses appendEventUnsafe
// semantics under the hood for r.step.aggregate.appendEvent.

import type { WriteEvent, WriteResult } from "./handlers";
import type { HandlerContext } from "./handlers";
import type { KumikoEventTypeMap } from "./event-type-map";

/**
 * The kind discriminator for a step instance — matches the step's
 * registration name in the step-registry (e.g. "return", "compute",
 * "aggregate.create"). Steps register themselves at module-load time
 * via defineStep().
 */
export type StepKind = string;

/**
 * Pipeline-side context handed to step argument resolvers.
 *
 * Contains the full HandlerContext (no per-step subset in M.1) plus
 * the accumulated `steps` map of prior step results, and a `scope`
 * for forEach/branch-local bindings.
 *
 * `scope` is currently `Record<string, unknown>` — sub-step builders
 * (forEach, branch) populate it in M.1 only when they land. M.1.1 only
 * uses event + steps.
 */
export type PipelineCtx<TPayload = unknown, TMap extends object = KumikoEventTypeMap> =
  HandlerContext<TMap> & {
    readonly event: WriteEvent<TPayload>;
    readonly steps: Readonly<Record<string, unknown>>;
    readonly scope: Readonly<Record<string, unknown>>;
  };

/**
 * A resolver is either a static value or a function that derives the
 * value from the pipeline-context. M.1 keeps the resolver signature
 * uniform — every step accepts both forms via a normalise helper.
 */
export type StepResolver<T, TPayload = unknown> = T | ((ctx: PipelineCtx<TPayload>) => T);

/**
 * Per-step error strategy. M.1.1 only supports "throw" — the type is
 * deliberately narrowed so callers cannot pass an unsupported strategy
 * past the type-checker. The doc lists "return" / "skip" / fallback as
 * future strategies; each lands together with its own runtime support
 * + integration test in a later slice (no untested type expansion).
 */
export type StepFailureStrategy = "throw";

export type StepDef<TArgs = unknown, TResult = unknown> = {
  readonly kind: StepKind;
  readonly defaultFailureStrategy: StepFailureStrategy;
  // Returns the result-key for this step instance, or undefined when the
  // step doesn't surface a result. The first-position name on the call
  // (e.g. r.step.compute("startedAt", fn) → "startedAt") becomes the key.
  readonly resultKey?: (args: TArgs) => string | undefined;
  // Runtime: resolve the args against the ctx, perform the work, return
  // the value to land in steps.{resultKey}. Throwing propagates to the
  // pipeline-runner which applies onFailure.
  readonly run: (args: TArgs, ctx: PipelineCtx) => Promise<TResult> | TResult;
};

/**
 * An instance of a step in a pipeline — what users build via the
 * step-builder (`r.step.compute(...)`). Carries the kind + resolved-or-
 * resolver args + the user-chosen onFailure override.
 *
 * `args` is `unknown` at this layer — the registered StepDef knows the
 * concrete shape and casts at run() time. Cross-step type-safety lives
 * in the per-step builder factories, not in this central type.
 */
export type StepInstance = {
  readonly kind: StepKind;
  readonly args: unknown;
  readonly onFailure?: StepFailureStrategy;
};

/**
 * What `pipeline(closure)` returns. Carrying the closure (instead of an
 * eagerly-built array) lets us pass `r` (the step-builder) at runtime
 * and lets each call see fresh event/steps refs.
 *
 * The factory tags this with `__kind: "pipeline"` so defineWriteHandler
 * can detect a pipeline-form `perform` and compile-to-handler.
 */
export type PipelineDef<TPayload = unknown, TData = unknown> = {
  readonly __kind: "pipeline";
  readonly build: (ctx: PipelineBuildCtx<TPayload>) => readonly StepInstance[];
  // Phantom data-type marker — exists only to thread TData through the
  // type system so defineWriteHandler can infer the WriteResult shape
  // from a pipeline-form perform.
  readonly __dataType?: TData;
};

/**
 * Argument bundle passed to the closure inside `pipeline(closure)`.
 * Mirrors PipelineCtx but is restricted to fields the closure should
 * read at build time — `r` is the step-builder, the rest are forwarded
 * from the live pipeline-ctx.
 *
 * The closure is invoked ONCE per handler-call, not once per step. It
 * returns the immutable list of step instances to execute. Values inside
 * the closure that depend on prior step results MUST go through resolvers
 * (functions) — direct `steps.foo.id` reads in the array body would only
 * see the empty initial state.
 */
export type PipelineBuildCtx<TPayload = unknown> = {
  readonly event: WriteEvent<TPayload>;
  readonly r: StepBuilder;
};

/**
 * Step-builder namespace handed to the pipeline closure. The fields
 * grow as M.1 adds more steps. Each is a thin factory that returns a
 * StepInstance — the runtime resolution happens later in run().
 *
 * Why nested under `step`: matches the doc-API surface and leaves room
 * for future sibling namespaces (`r.trigger`, `r.transform`) without
 * crowding the top-level r.
 */
export type StepBuilder = {
  readonly step: StepNamespace;
};

/**
 * The collection of step factory functions. Grown incrementally — M.1.1
 * lands `return` only; subsequent slices add compute, branch, forEach,
 * read.*, aggregate.*, db.*.
 */
export type StepNamespace = {
  readonly return: <TData>(
    resolver: StepResolver<WriteResult<TData>>,
  ) => StepInstance;
  // M.1.2+: compute, branch, forEach, read, aggregate, db, ...
};

