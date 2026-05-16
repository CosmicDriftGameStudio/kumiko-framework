// TargetRef — runtime-Repräsentation eines typed buildTarget-Outputs.
// Wird vom Visual-Tree-Component (renderer-web) an einen Target-Resolver
// dispatcht; der Resolver findet die Editor-Maske via featureId.
//
// **Compile-time-Safety:** TargetRef wird niemals hand-getippt. Stattdessen
// erzeugt der typed buildTarget-Builder (engine/build-target.ts) einen
// TargetRef, dessen action + args gegen die treeActions-Map des Ziel-
// Features validiert sind.
//
// **Runtime:** args sind hier untyped (Record<string, unknown>), weil
// TargetRef die erased-runtime-Version ist. Der Resolver kennt das
// Ziel-Feature und kann args entsprechend casten — ähnlich wie Event-
// Payloads im Event-Store.
//
// Siehe docs/plans/architecture/visual-tree.md A5.

export type TargetRef = {
  readonly featureId: string;
  readonly action: string;
  readonly args?: Readonly<Record<string, unknown>>;
};
