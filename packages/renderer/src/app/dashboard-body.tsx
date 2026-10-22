// The KumikoScreen switch is platform-agnostic, but dashboard panels (StatCard, Charts) are not.
// The implementation therefore comes from the platform package (renderer/web registers its web
// variant in createKumikoApp), following the same pattern as CustomScreensProvider.

import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ComponentType, createContext, type ReactNode, useContext } from "react";
import type { Translate } from "../headless/index.ts";

export type DashboardBodyProps = {
  readonly featureName: string;
  readonly screen: DashboardScreenDefinition;
  readonly translate?: Translate;
};

const DashboardBodyContext = createContext<ComponentType<DashboardBodyProps> | undefined>(
  undefined,
);

export type DashboardBodyProviderProps = {
  readonly children: ReactNode;
  readonly value: ComponentType<DashboardBodyProps>;
};

export function DashboardBodyProvider({ children, value }: DashboardBodyProviderProps): ReactNode {
  return <DashboardBodyContext.Provider value={value}>{children}</DashboardBodyContext.Provider>;
}

/** Undefined when no platform package has registered a dashboard body;
 * KumikoScreen then displays its placeholder banner. */
export function useDashboardBody(): ComponentType<DashboardBodyProps> | undefined {
  return useContext(DashboardBodyContext);
}
