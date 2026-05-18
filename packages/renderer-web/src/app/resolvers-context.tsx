// ResolversContext — stellt Editor-Resolver-Komponenten für das
// EditorPanel bereit. Aggregiert in createKumikoApp aus allen
// clientFeatures.resolvers, analog zu treeProviders-context.
// Siehe visual-tree.md V.1.2.

import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import type { ComponentType, ReactNode } from "react";
import { createContext, useContext } from "react";

export type ResolverComponent = ComponentType<{
  readonly target: TargetRef;
  readonly onClose: () => void;
}>;

const ResolversContext = createContext<ReadonlyMap<string, ResolverComponent> | null>(null);

export type ResolversProviderProps = {
  readonly resolvers: ReadonlyMap<string, ResolverComponent>;
  readonly children: ReactNode;
};

export function ResolversProvider({ resolvers, children }: ResolversProviderProps): ReactNode {
  return <ResolversContext.Provider value={resolvers}>{children}</ResolversContext.Provider>;
}

export function useResolvers(): ReadonlyMap<string, ResolverComponent> {
  const ctx = useContext(ResolversContext);
  return ctx ?? new Map();
}
