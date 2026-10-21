// Custom-screen component map: client-side lookup for screens of type
// `custom`. KumikoScreen looks up `screen.id` (or qn) here and renders
// the matching component. createKumikoApp in renderer/web collects all
// clientFeatures.components and mounts the provider; tests that check
// individual custom screens mount the provider directly.

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

/** Looks up the component for a custom screen. Returns undefined
 *  when neither a provider is mounted nor screenId is in the map—the
 *  caller (KumikoScreen) then displays its placeholder banner. */
export function useCustomScreenComponent(screenId: string): ComponentType | undefined {
  const map = useContext(CustomScreensContext);
  if (map === undefined) return undefined;
  return map[screenId];
}
