import { type ReactNode, useCallback, useMemo, useState } from "react";
import { NavOverrideProvider, useNav } from "./nav.tsx";

// The detail keeps its tab in the `tab` search param. Inside a drawer that param would
// land in the URL of the list behind it and outlive the drawer, so the drawer scopes
// search params to its own state.
export function DrawerDetailScope({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useNav();
  const [searchParams, setSearchParamsState] = useState<Readonly<Record<string, string>>>({});
  const setSearchParams = useCallback((updates: Readonly<Record<string, string | null>>) => {
    setSearchParamsState((current) => {
      const next: Record<string, string> = { ...current };
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
      return next;
    });
  }, []);
  const scopedNav = useMemo(
    () => ({ ...nav, searchParams, setSearchParams }),
    [nav, searchParams, setSearchParams],
  );
  return <NavOverrideProvider value={scopedNav}>{children}</NavOverrideProvider>;
}
