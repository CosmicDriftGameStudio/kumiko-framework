import { createContext, type ReactNode, useContext } from "react";
import { normalizeBasePath } from "./base-path.ts";

const BasePathContext = createContext("");

/** Provides the URL prefix the app is mounted under to components outside the NavProvider
 *  (auth gates and pages). `createKumikoApp({ basePath })` mounts it. */
export function BasePathProvider({
  basePath,
  children,
}: {
  readonly basePath: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <BasePathContext.Provider value={normalizeBasePath(basePath)}>
      {children}
    </BasePathContext.Provider>
  );
}

/** Normalized base path ("" when the app is served from the root). */
export function useBasePath(): string {
  return useContext(BasePathContext);
}
