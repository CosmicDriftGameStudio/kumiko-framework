import { useState } from "react";

// Callers often pass fresh object literals every render; this keeps the first
// value for as long as the content key is unchanged, so memoized extension
// lists (and the editor built from them) are not rebuilt on every render.
export function useStableByKey<T>(value: T, key: string): T {
  const [stored, setStored] = useState({ key, value });
  if (stored.key !== key) {
    setStored({ key, value });
    return value;
  }
  return stored.value;
}
