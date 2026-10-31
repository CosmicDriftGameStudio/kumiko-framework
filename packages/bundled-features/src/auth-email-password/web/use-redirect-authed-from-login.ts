import { type NavTarget, useNav } from "@cosmicdrift/kumiko-renderer";
import { useEffect, useRef } from "react";
import { useSession } from "./session.tsx";

export function isAuthedOnLoginPath(authed: boolean, pathname: string, loginPath: string): boolean {
  return authed && pathname === loginPath;
}

export type UseRedirectAuthedFromLoginOptions = {
  readonly loginPath: string;
  readonly target: NavTarget;
};

// The SPA has no screen at the login path: after a login the URL stays there, and marketing
// links land there directly. replace, not navigate: a push would make Browser-Back from the
// target land on the login path again, which redirects forward again (history ping-pong).
export function useRedirectAuthedFromLogin({
  loginPath,
  target,
}: UseRedirectAuthedFromLoginOptions): void {
  const session = useSession();
  const nav = useNav();
  const authed = session.user !== null;
  // Callers pass an inline object; a ref keeps it out of the effect deps.
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const redirectIfStranded = () => {
      if (isAuthedOnLoginPath(authed, window.location.pathname, loginPath))
        nav.replace(targetRef.current);
    };
    redirectIfStranded();
    // Browser-Back to the login path changes neither authed nor nav, so the effect alone would not re-fire.
    window.addEventListener("popstate", redirectIfStranded);
    return () => window.removeEventListener("popstate", redirectIfStranded);
  }, [authed, nav, loginPath]);
}
