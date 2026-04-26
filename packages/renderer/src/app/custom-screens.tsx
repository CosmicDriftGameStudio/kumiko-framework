// Custom-Screen-Components-Map: client-side Lookup für Screens vom Typ
// `custom`. KumikoScreen schaut hier nach `screen.id` (oder qn) und
// rendert die passende Component. createKumikoApp im renderer-web sammelt
// alle clientFeatures.components und mountet den Provider; Tests die
// einzelne Custom-Screens prüfen wollen, mounten den Provider direkt.

import { type ComponentType, createContext, type ReactNode, useContext } from "react";

export type CustomScreensMap = Readonly<Record<string, ComponentType>>;

const CustomScreensContext = createContext<CustomScreensMap | undefined>(undefined);

export type CustomScreensProviderProps = {
  readonly children: ReactNode;
  readonly value: CustomScreensMap;
};

export function CustomScreensProvider({ children, value }: CustomScreensProviderProps): ReactNode {
  return <CustomScreensContext.Provider value={value}>{children}</CustomScreensContext.Provider>;
}

/** Schaut die Component für ein Custom-Screen nach. Returnt undefined
 *  wenn weder Provider gemounted noch screenId in der Map ist — der
 *  Caller (KumikoScreen) zeigt dann seinen Placeholder-Banner. */
export function useCustomScreenComponent(screenId: string): ComponentType | undefined {
  const map = useContext(CustomScreensContext);
  if (map === undefined) return undefined;
  return map[screenId];
}
