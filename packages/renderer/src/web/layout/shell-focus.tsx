// Per-screen focused shell: while a screen holds focus mode, ShellHeader reduces itself to the
// screen's own PageHeader content and a collapsed sidebar shows the focus rail. The sidebar's
// expanded state is never changed by focus mode; only the user's own clicks change it.
//
// Why register/unregister instead of a prop: the shell sits above every screen and cannot
// know which one wants the focused chrome; the screen opts in by mounting the hook.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

type ShellFocusContextValue = {
  readonly focused: boolean;
  readonly register: () => () => void;
  readonly topbarActions?: ReactNode;
};

const ShellFocusContext = createContext<ShellFocusContextValue | null>(null);

export const ShellFocusProvider = ShellFocusContext.Provider;

export type ShellFocusHost = {
  readonly focused: boolean;
  readonly value: ShellFocusContextValue;
};

/** Shell side: holds the focus counter. */
export function useShellFocusHost(topbarActions?: ReactNode): ShellFocusHost {
  const [holders, setHolders] = useState(0);

  const register = useCallback(() => {
    setHolders((count) => count + 1);
    return () => setHolders((count) => count - 1);
  }, []);

  const focused = holders > 0;
  const value = useMemo(
    () => ({ focused, register, topbarActions }),
    [focused, register, topbarActions],
  );
  return { focused, value };
}

/** True while any mounted screen holds focus mode (always false outside DefaultAppShell). */
export function useShellFocused(): boolean {
  return useContext(ShellFocusContext)?.focused ?? false;
}

/** The shell's topbarActions, for focused screens whose MobileTopBar replaces the shell header. */
export function useShellTopbarActions(): ReactNode | undefined {
  return useContext(ShellFocusContext)?.topbarActions;
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
