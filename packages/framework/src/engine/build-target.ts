// buildTarget — typed builder for TargetRef.
//
// **What it does.** Creates a TargetRef whose action and args are
// validated at compile time against the target feature's treeActions map.
// Magic-string URIs are never typed by hand; this is the single source
// of truth for cross-feature linking in the visual tree.
//
// **How it is typed.** Function overloads separate actions without args
// (NoArgsAction) from actions with args (WithArgsAction). TypeScript validates:
//   - action is a string literal from the keys of treeActions
//   - for WithArgsAction, args is required and matches
//     treeActions[action]["args"]
//   - for NoArgsAction, args is not allowed
//
// **Feature handle.** It is currently a generic constraint
// (FeatureWithTreeActions). Once treeActions becomes a pattern type in the
// feature AST and defineFeature exposes a treeActions slot with the same
// shape, real features will fit without changing the builder.

import type { TargetRef } from "./types/target-ref.ts";
import type { TreeActionDef } from "./types/tree-node.ts";

// FeatureWithTreeActions — internal generic constraint for the builder.
// **Intentionally not exported** — a temporary stub that will be replaced
// by a real FeatureDefinition with a treeActions slot. Callers do not need
// this type directly; TypeScript infers it from buildTarget's `target` argument.
type FeatureWithTreeActions<TActions extends Record<string, TreeActionDef>> = {
  readonly id: string;
  readonly treeActions: TActions;
};

// NoArgsAction<T> — union of action names that have no args definition.
// The mapped type emits either K (no args) or never (args present) for each
// key; the `[keyof T]` index lookup reduces this to the K keys.
// `& string` removes number and symbol keys that TypeScript could
// theoretically allow through keyof; action names are strings only.
type NoArgsAction<T extends Record<string, TreeActionDef>> = {
  [K in keyof T]: T[K] extends { args: unknown } ? never : K;
}[keyof T] &
  string;

// WithArgsAction<T> — complement of NoArgsAction: union of action names
// that declare `args`. It uses the same mechanism with an inverted
// conditional. Separating the two unions is necessary so the function
// overloads (NoArgs versus WithArgs) are typed correctly.
type WithArgsAction<T extends Record<string, TreeActionDef>> = {
  [K in keyof T]: T[K] extends { args: unknown } ? K : never;
}[keyof T] &
  string;

// Type guard for args: overloads guarantee a plain object, but the
// implementation signature sees args as unknown (TArgs is erased at
// runtime). The guard validates the plain-object convention at runtime
// instead of using an `as` cast.
function isArgsObject(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Overload: action without args
export function buildTarget<
  TActions extends Record<string, TreeActionDef>,
  TActionName extends NoArgsAction<TActions>,
>(spec: {
  readonly target: FeatureWithTreeActions<TActions>;
  readonly action: TActionName;
}): TargetRef;

// Overload: action with args (required and typed)
export function buildTarget<
  TActions extends Record<string, TreeActionDef>,
  TActionName extends WithArgsAction<TActions>,
>(spec: {
  readonly target: FeatureWithTreeActions<TActions>;
  readonly action: TActionName;
  readonly args: TActions[TActionName] extends { args: infer TArgs } ? TArgs : never;
}): TargetRef;

// Implementation — args is `unknown` because the overloads' generic TArgs
// is erased at runtime. The plain-object convention is enforced via the type guard.
export function buildTarget(spec: {
  readonly target: { readonly id: string };
  readonly action: string;
  readonly args?: unknown;
}): TargetRef {
  if (!isArgsObject(spec.args)) {
    return Object.freeze({
      featureId: spec.target.id,
      action: spec.action,
    });
  }
  return Object.freeze({
    featureId: spec.target.id,
    action: spec.action,
    args: Object.freeze({ ...spec.args }),
  });
}
