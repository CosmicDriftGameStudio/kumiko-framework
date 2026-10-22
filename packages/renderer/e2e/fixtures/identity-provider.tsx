// Test identity for the renderer e2e: the start value comes from
// window.__E2E_IDENTITY__ (addInitScript), tests change it at runtime
// through window.__e2eSetIdentity(identity | undefined).

import { CurrentUserProvider } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useMemo, useState } from "react";

export type E2eIdentity = { readonly id: string; readonly tenantId: string };

type IdentityWindow = Window & {
  __E2E_IDENTITY__?: E2eIdentity;
  __e2eSetIdentity?: (identity: E2eIdentity | undefined) => void;
};

export function TestIdentityProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const identityWindow: IdentityWindow = window;
  const [identity, setIdentity] = useState<E2eIdentity | undefined>(
    identityWindow.__E2E_IDENTITY__,
  );
  useEffect(() => {
    identityWindow.__e2eSetIdentity = setIdentity;
    return () => {
      delete identityWindow.__e2eSetIdentity;
    };
  }, []);
  const user = useMemo(
    () =>
      identity === undefined
        ? undefined
        : {
            id: identity.id,
            tenantId: identity.tenantId,
            email: `${identity.id}@example.com`,
            displayName: identity.id,
          },
    [identity],
  );
  return <CurrentUserProvider user={user}>{children}</CurrentUserProvider>;
}
