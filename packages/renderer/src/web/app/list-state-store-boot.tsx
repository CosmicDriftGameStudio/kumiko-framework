import { type ReactNode, useMemo } from "react";
import { ListStateStoreProvider } from "../../components/list-state-store.tsx";
import { useOptionalCurrentUser } from "../../current-user.tsx";
import { resolveListStateStore } from "./session-list-state-store.ts";

/** Provides the tab-scoped list-state store and drops state remembered under
 *  another user or tenant. Mount below the auth gates so the user is known. */
export function ListStateStoreBoot({ children }: { readonly children: ReactNode }): ReactNode {
  const user = useOptionalCurrentUser();
  const userId = user?.id;
  const tenantId = user?.tenantId;
  // Must run before the first list renders; an effect would let it read the previous identity's state.
  const store = useMemo(
    () => resolveListStateStore(userId === undefined ? undefined : { userId, tenantId }),
    [userId, tenantId],
  );
  return <ListStateStoreProvider store={store}>{children}</ListStateStoreProvider>;
}
