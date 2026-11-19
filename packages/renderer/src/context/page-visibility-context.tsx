import { createContext, type ReactNode, useContext } from "react";
import type { Store } from "../headless/index.ts";

export type PageVisibilityState = "visible" | "hidden";

// Native and tests have no page to hide; the web app injects the document state.
const ALWAYS_VISIBLE: Store<PageVisibilityState> = {
  getSnapshot: () => "visible",
  subscribe: () => () => {},
};

const PageVisibilityContext = createContext<Store<PageVisibilityState>>(ALWAYS_VISIBLE);

export function PageVisibilityProvider({
  value,
  children,
}: {
  readonly value: Store<PageVisibilityState>;
  readonly children: ReactNode;
}): ReactNode {
  return <PageVisibilityContext value={value}>{children}</PageVisibilityContext>;
}

export function usePageVisibility(): Store<PageVisibilityState> {
  return useContext(PageVisibilityContext);
}
