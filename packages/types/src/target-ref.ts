// TargetRef — runtime representation of a typed buildTarget output.
// It is dispatched by the Visual Tree component (renderer/web) to a target
// resolver, which finds the editor form via featureId.
//
// **Compile-time safety:** TargetRef is never written by hand. Instead, the
// typed buildTarget builder (engine/build-target.ts) creates a TargetRef whose
// action + args are validated against the target feature's treeActions map.
//
// **Runtime:** args are untyped here (Record<string, unknown>) because
// TargetRef is the erased runtime version. The resolver knows the target
// feature and can cast args accordingly, similar to event payloads in the
// event store.

export type TargetRef = {
  readonly featureId: string;
  readonly action: string;
  readonly args?: Readonly<Record<string, unknown>>;
};
