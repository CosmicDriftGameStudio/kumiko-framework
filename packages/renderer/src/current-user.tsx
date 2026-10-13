import { createContext, type ReactNode, useContext } from "react";

/** The signed-in user as the renderer sees it. Provided by the auth layer
 *  (auth-email-password's SessionProvider); absent in apps without one. */
export type CurrentUser = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  /** Effective IANA zone of the user (override, else tenant). */
  readonly timeZone?: string;
};

const CurrentUserContext = createContext<CurrentUser | undefined>(undefined);

export function CurrentUserProvider({
  user,
  children,
}: {
  readonly user: CurrentUser | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}

/** Non-throwing: undefined outside a provider or while signed out. */
export function useOptionalCurrentUser(): CurrentUser | undefined {
  return useContext(CurrentUserContext);
}
