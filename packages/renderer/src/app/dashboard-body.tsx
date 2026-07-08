// Dashboard-Body-Injection: der KumikoScreen-Switch ist plattform-agnostisch,
// die Dashboard-Panels (StatCard, Charts) sind es nicht — die Implementierung
// kommt vom Platform-Package (renderer-web registriert seine Web-Variante in
// createKumikoApp). Gleiches Muster wie CustomScreensProvider.

import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "@cosmicdrift/kumiko-headless";
import { type ComponentType, createContext, type ReactNode, useContext } from "react";

export type DashboardBodyProps = {
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

/** Undefined wenn kein Platform-Package einen Dashboard-Body registriert
 *  hat — KumikoScreen zeigt dann seinen Placeholder-Banner. */
export function useDashboardBody(): ComponentType<DashboardBodyProps> | undefined {
  return useContext(DashboardBodyContext);
}
