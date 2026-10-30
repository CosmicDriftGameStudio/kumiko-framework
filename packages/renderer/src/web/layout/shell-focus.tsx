// Per-screen focused shell: while a screen holds focus mode, DefaultAppShell shows the
// collapsed icon rail and ShellHeader reduces itself to the screen's own PageHeader content.
//
// Why register/unregister instead of a prop: the shell sits above every screen and cannot
// know which one wants the focused chrome; the screen opts in by mounting the hook.

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";

type ShellFocusContextValue = {
  readonly focused: boolean;
  readonly register: () => () => void;
};

const ShellFocusContext = createContext<ShellFocusContextValue | null>(null);

export const ShellFocusProvider = ShellFocusContext.Provider;

export type ShellFocusHost = {
  readonly focused: boolean;
  /** Rail expansion while focused; kept apart from the user's own sidebar state so leaving restores it. */
  readonly railOpen: boolean;
  readonly setRailOpen: (open: boolean) => void;
  readonly value: ShellFocusContextValue;
};

/** Shell side: holds the focus counter and the temporary rail state. */
export function useShellFocusHost(): ShellFocusHost {
  const [holders, setHolders] = useState(0);
  const [railOpen, setRailOpen] = useState(false);

  const register = useCallback(() => {
    setRailOpen(false);
    setHolders((count) => count + 1);
    return () => setHolders((count) => count - 1);
  }, []);

  const focused = holders > 0;
  const value = useMemo(() => ({ focused, register }), [focused, register]);
  return { focused, railOpen, setRailOpen, value };
}

/** True while any mounted screen holds focus mode (always false outside DefaultAppShell). */
export function useShellFocused(): boolean {
  return useContext(ShellFocusContext)?.focused ?? false;
}

/** Screen side: call while the screen is mounted to get the focused shell. No-op without a DefaultAppShell. */
export function useShellFocusMode(): void {
  const register = useContext(ShellFocusContext)?.register;
  // Layout effect so the first paint already shows the rail instead of flashing the full sidebar.
  useLayoutEffect(() => {
    if (register === undefined) return;
    return register();
  }, [register]);
}
