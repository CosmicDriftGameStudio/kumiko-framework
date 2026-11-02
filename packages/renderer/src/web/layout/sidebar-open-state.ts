import { useCallback, useState } from "react";

const STORAGE_KEY = "kumiko.sidebar.open";

// Expanded unless the user collapsed it; storage failures (privacy mode, SSR) fall back to expanded.
function readStoredOpen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeStoredOpen(open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(open));
  } catch {
    // storage unavailable: the choice just stops surviving a reload
  }
}

export type PersistedSidebarOpen = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
};

/** The sidebar's expanded state, changed only by user actions and kept across screens and reloads. */
export function usePersistedSidebarOpen(): PersistedSidebarOpen {
  const [open, setOpenState] = useState(readStoredOpen);
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    writeStoredOpen(next);
  }, []);
  return { open, setOpen };
}
