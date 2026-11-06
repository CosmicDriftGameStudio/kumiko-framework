import { useCallback, useEffect, useState } from "react";
import { toggleSetMember } from "../../toggle-set-member.ts";

const STORAGE_KEY = "kumiko.nav.collapsed";
const REVEALED_SCREEN_KEY = "kumiko.nav.revealedScreen";

// Storage can be missing (SSR, Metro), blocked (privacy mode) or hold foreign
// data, so every access degrades to "nothing collapsed" instead of throwing.
function readStoredCollapsed(): ReadonlySet<string> {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

function writeStoredCollapsed(collapsed: ReadonlySet<string>): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed]));
  } catch {
    // storage unavailable: the state just stops surviving a remount
  }
}

function readRevealedScreen(): string | null {
  try {
    return window.sessionStorage.getItem(REVEALED_SCREEN_KEY);
  } catch {
    return null;
  }
}

function writeRevealedScreen(screenId: string): void {
  try {
    window.sessionStorage.setItem(REVEALED_SCREEN_KEY, screenId);
  } catch {
    // storage unavailable: a remount may reveal the active path once more
  }
}

/** Forgets the collapsed containers and the revealed screen; logout calls it so the next user starts expanded. */
export function clearNavCollapseState(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(REVEALED_SCREEN_KEY);
  } catch {
    // storage unavailable: nothing was persisted
  }
}

// The sidebar body remounts when the shell swaps it (focus mode, mobile sheet),
// so the explicitly collapsed qualified names live in sessionStorage, not in
// component state alone.
export function usePersistedNavCollapse(): {
  readonly collapsed: ReadonlySet<string>;
  readonly toggle: (qualifiedName: string) => void;
  readonly revealOnScreenChange: (screenId: string, qualifiedNames: readonly string[]) => void;
} {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readStoredCollapsed);
  useEffect(() => writeStoredCollapsed(collapsed), [collapsed]);
  const toggle = useCallback((qualifiedName: string) => {
    setCollapsed((prev) => toggleSetMember(prev, qualifiedName));
  }, []);
  const revealOnScreenChange = useCallback(
    (screenId: string, qualifiedNames: readonly string[]) => {
      // skip: this screen's path was already revealed once; later collapses stay
      if (readRevealedScreen() === screenId) return;
      writeRevealedScreen(screenId);
      setCollapsed((prev) => {
        if (!qualifiedNames.some((qn) => prev.has(qn))) return prev;
        return new Set([...prev].filter((qn) => !qualifiedNames.includes(qn)));
      });
    },
    [],
  );
  return { collapsed, toggle, revealOnScreenChange };
}
