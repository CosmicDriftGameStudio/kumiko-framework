// buildTarget — typed Builder für TargetRef.
//
// **Was er macht.** Erzeugt einen TargetRef, dessen action + args
// compile-time gegen die treeActions-Map des Ziel-Features validiert
// sind. Magic-String-URIs werden nirgends hand-getippt; das ist die
// Single-Source-of-Truth für Cross-Feature-Linking im Visual-Tree.
//
// **Wie er typed.** Function-Overloads splitten Actions ohne args
// (NoArgsAction) und Actions mit args (WithArgsAction). TS validiert:
//   - action ist string-literal aus den Keys von treeActions
//   - bei WithArgsAction sind args required und matchen
//     treeActions[action]["args"]
//   - bei NoArgsAction ist args nicht erlaubt
//
// **Phase 0.** Das Feature-Handle ist hier eine generische Constraint
// (FeatureWithTreeActions). In Schicht 2 wird treeActions ein
// Pattern-Type im Feature-AST und defineFeature exposed eine
// treeActions-Slot mit gleichem Shape — dann passen real Features
// drauf, ohne Builder-Änderung.
//
// Siehe docs/plans/architecture/visual-tree.md A5.

import type { TargetRef } from "./types/target-ref";
import type { TreeActionDef } from "./types/tree-node";

// TreeActionDef wird re-exported (für Public-API-Kompatibilität —
// Caller importieren weiterhin von engine), lebt aber kanonisch in
// types/tree-node.ts (Visual-Tree-Domäne, nicht Builder-Domäne).
export type { TreeActionDef };

// FeatureWithTreeActions — internal Generic-Constraint für den Builder.
// **Bewusst nicht exportiert** — Phase-0-Stub, wird in V.1.1 durch echte
// FeatureDefinition mit treeActions-Slot ersetzt. Caller brauchen den Type
// nicht direkt; TS leitet ihn aus dem `target`-Argument von buildTarget ab.
type FeatureWithTreeActions<TActions extends Record<string, TreeActionDef>> = {
  readonly id: string;
  readonly treeActions: TActions;
};

// NoArgsAction<T> — Union der Action-Namen die KEINE args-Definition
// haben. Mapped-Type emittiert pro Key entweder K (kein args) oder never
// (args vorhanden); Index-Lookup `[keyof T]` reduziert auf die K-Keys.
// `& string` schneidet number/symbol-keys raus die TS via keyof
// theoretisch zulassen würde — Action-Namen sind ausschließlich Strings.
type NoArgsAction<T extends Record<string, TreeActionDef>> = {
  [K in keyof T]: T[K] extends { args: unknown } ? never : K;
}[keyof T] &
  string;

// WithArgsAction<T> — Komplement zu NoArgsAction: Union der Action-
// Namen die `args` deklariert haben. Selbe Mechanik mit invertiertem
// conditional. Trennung in zwei Unions ist nötig damit die Function-
// Overloads (NoArgs vs. WithArgs) sauber typed werden können.
type WithArgsAction<T extends Record<string, TreeActionDef>> = {
  [K in keyof T]: T[K] extends { args: unknown } ? K : never;
}[keyof T] &
  string;

// TypeGuard für args: Overloads garantieren ein Plain-Object, aber die
// Implementation-Signature sieht args als unknown (TArgs ist erased zur
// Laufzeit). Der Guard validiert die Plain-Object-Convention runtime
// statt einen `as`-Cast zu setzen — siehe coding-standards.md.
function isArgsObject(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Overload 1: action ohne args
export function buildTarget<
  TActions extends Record<string, TreeActionDef>,
  TActionName extends NoArgsAction<TActions>,
>(spec: {
  readonly target: FeatureWithTreeActions<TActions>;
  readonly action: TActionName;
}): TargetRef;

// Overload 2: action mit args (required + typed)
export function buildTarget<
  TActions extends Record<string, TreeActionDef>,
  TActionName extends WithArgsAction<TActions>,
>(spec: {
  readonly target: FeatureWithTreeActions<TActions>;
  readonly action: TActionName;
  readonly args: TActions[TActionName] extends { args: infer TArgs } ? TArgs : never;
}): TargetRef;

// Implementation — args ist `unknown` weil die Overloads-Generic-TArgs
// zur Laufzeit erased ist. Plain-Object-Convention via TypeGuard.
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
