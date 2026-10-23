import { useEffect, useRef, useState } from "react";

const SEARCH_DEBOUNCE_MS = 300;

// Local search buffer + debounce. External changes (browser back,
// cross-component reset) are mirrored back; typing only fires
// onSearchChange after 300ms without further keystrokes.
export function useRenderListSearch(
  searchValue: string | undefined,
  onSearchChange: ((next: string) => void) | undefined,
): { readonly localQ: string; readonly setLocalQ: (next: string) => void } {
  const [localQ, setLocalQ] = useState(searchValue ?? "");
  // Sync during render, not in a useEffect: the passive effect also fires on
  // mount and can flush after a keystroke landing in the same commit,
  // resetting localQ and swallowing the input.
  const [syncedSearchValue, setSyncedSearchValue] = useState(searchValue);
  // The parent may echo our own debounced emits back late (router/URL round
  // trip), possibly after a newer emit already went out; adopting such a stale
  // echo would erase keys typed in between. All unechoed emits are kept, and a
  // matching echo drops itself and every older one. The render phase only reads
  // the list (a discarded or repeated render must find the echo again); the
  // matched entries are dropped in an effect.
  const pendingEmitsRef = useRef<string[]>([]);
  if (searchValue !== syncedSearchValue) {
    setSyncedSearchValue(searchValue);
    if (!pendingEmitsRef.current.includes(searchValue ?? "")) {
      setLocalQ(searchValue ?? "");
      pendingEmitsRef.current = [];
    }
  }
  useEffect(() => {
    const echoIndex = pendingEmitsRef.current.indexOf(syncedSearchValue ?? "");
    if (echoIndex >= 0) pendingEmitsRef.current.splice(0, echoIndex + 1);
  }, [syncedSearchValue]);
  useEffect(() => {
    // skip: no search handler wired, so typing never emits
    if (onSearchChange === undefined) return;
    // skip: buffer already matches the parent value
    if (localQ === (searchValue ?? "")) return;
    // A late echo of an older emit changes searchValue but must not re-send
    // the value that is already in flight.
    // skip: that value is already in flight
    if (pendingEmitsRef.current.at(-1) === localQ) return;
    const timer = setTimeout(() => {
      pendingEmitsRef.current.push(localQ);
      onSearchChange(localQ);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [localQ, searchValue, onSearchChange]);
  return { localQ, setLocalQ };
}
