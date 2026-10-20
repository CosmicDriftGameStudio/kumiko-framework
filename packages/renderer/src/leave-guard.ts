import { useEffect, useRef } from "react";

// Platform-neutral on purpose (no DOM): forms register whether they hold
// unsaved input, navigation entry points ask before leaving. Module-level
// because the web nav (history/popstate) lives outside the React tree.
type UnsavedInputSource = () => boolean;
type LeaveConfirmer = (decision: {
  readonly proceed: () => void;
  readonly cancel: () => void;
}) => void;

const sources = new Set<UnsavedInputSource>();
let confirmer: LeaveConfirmer | undefined;

export function registerUnsavedInputSource(source: UnsavedInputSource): () => void {
  sources.add(source);
  return () => {
    sources.delete(source);
  };
}

export function hasUnsavedInput(): boolean {
  for (const source of sources) if (source()) return true;
  return false;
}

export function setLeaveConfirmer(next: LeaveConfirmer): () => void {
  confirmer = next;
  return () => {
    if (confirmer === next) confirmer = undefined;
  };
}

/** Runs `proceed` right away when nothing is dirty (or no dialog host is
 *  mounted); otherwise asks the user first. */
export function requestLeave(proceed: () => void, cancel: () => void = () => {}): void {
  if (confirmer === undefined || !hasUnsavedInput()) {
    proceed();
    // skip: nothing to lose, no question needed
    return;
  }
  confirmer({ proceed, cancel });
}

/** `isDirty` is read lazily, at guard time, so a form can report "clean"
 *  synchronously after a successful save — before React re-renders. */
export function useUnsavedInputSource(isDirty: () => boolean): void {
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  useEffect(() => registerUnsavedInputSource(() => isDirtyRef.current()), []);
}
