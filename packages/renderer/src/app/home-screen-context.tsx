import { createContext, type ReactNode, useContext } from "react";

const HomeScreenContext = createContext<string | undefined>(undefined);

/** Short screen id of the app's start page, for components that sit outside
 *  the screen resolution (the "page not available" state offers it as the way
 *  back). `createKumikoApp` mounts it; `undefined` = no known start page. */
export function HomeScreenProvider({
  homeScreenId,
  children,
}: {
  readonly homeScreenId: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return <HomeScreenContext.Provider value={homeScreenId}>{children}</HomeScreenContext.Provider>;
}

export function useHomeScreenId(): string | undefined {
  return useContext(HomeScreenContext);
}
