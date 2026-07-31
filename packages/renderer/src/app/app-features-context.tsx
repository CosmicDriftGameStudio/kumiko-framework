// Cross-feature schema access for components that need to resolve a
// screen owned by a DIFFERENT feature than the one they're rendering
// under — e.g. a reference field opening the target entity's create
// screen (kumiko-framework#1681). `createKumikoApp` provides the full
// `app.features` list; components elsewhere in the render tree default
// to an empty list (no cross-feature schema known, e.g. outside
// createKumikoApp or in isolated tests).

import { createContext, type ReactNode, useContext } from "react";
import type { FeatureSchema } from "./feature-schema";

const AppFeaturesContext = createContext<readonly FeatureSchema[]>([]);

export type AppFeaturesProviderProps = {
  readonly features: readonly FeatureSchema[];
  readonly children: ReactNode;
};

export function AppFeaturesProvider({ features, children }: AppFeaturesProviderProps): ReactNode {
  return <AppFeaturesContext.Provider value={features}>{children}</AppFeaturesContext.Provider>;
}

export function useAppFeatures(): readonly FeatureSchema[] {
  return useContext(AppFeaturesContext);
}
