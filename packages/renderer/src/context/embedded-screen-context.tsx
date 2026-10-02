import { createContext, type ReactNode, useContext } from "react";

// A host that already frames and pads the embedded screen (dashboard panel
// with `chromeless`) marks the subtree, so list screens drop their own
// screen padding and card frame instead of stacking it on the host's.
const EmbeddedScreenContext = createContext(false);

export function EmbeddedScreenProvider({ children }: { readonly children: ReactNode }): ReactNode {
  return <EmbeddedScreenContext value={true}>{children}</EmbeddedScreenContext>;
}

export function useIsEmbeddedScreen(): boolean {
  return useContext(EmbeddedScreenContext);
}
