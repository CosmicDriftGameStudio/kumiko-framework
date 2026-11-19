import { useCallback, useState } from "react";

/** Form state for calculator screens: a draft object plus `patch` for
 *  partial updates, and `field(name)` that provides `{ id, name, value, onChange }`
 *  props ready for field widgets (NumberField/MoneyField/PercentField).
 *  Replaces the repeated draft interface and patch helper in each screen.
 *  `idPrefix` prevents duplicate DOM `id`s when multiple `useDraft` forms with
 *  same-named fields are mounted on the same page; `name` remains the plain key
 *  for the form payload. `initialFrom` copies `values` into the draft once per
 *  `key` (edit screens loading a row from useQuery); `key: null` resets to `defaults`. */
export function useDraft<T extends object>(
  defaults: T,
  options?: {
    readonly idPrefix?: string;
    readonly initialFrom?: { readonly key: string | null; readonly values: T | undefined };
  },
): {
  readonly draft: T;
  readonly loadedKey: string | null;
  readonly patch: (changes: Partial<T>) => void;
  readonly reset: () => void;
  readonly field: <K extends keyof T>(
    name: K,
  ) => {
    readonly id: string;
    readonly name: string;
    readonly value: T[K];
    readonly onChange: (v: T[K]) => void;
  };
} {
  const idPrefix = options?.idPrefix;
  const initialFrom = options?.initialFrom;
  const [draft, setDraft] = useState<T>(defaults);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // Adjusted during render instead of in an effect: the loaded values show on the first paint, and a refetch for the same key keeps the user's edits.
  if (initialFrom !== undefined && initialFrom.key !== loadedKey) {
    if (initialFrom.key === null) {
      setDraft(defaults);
      setLoadedKey(null);
    } else if (initialFrom.values !== undefined) {
      setDraft(initialFrom.values);
      setLoadedKey(initialFrom.key);
    }
  }
  const patch = useCallback((changes: Partial<T>) => setDraft((d) => ({ ...d, ...changes })), []);
  const reset = useCallback(() => setDraft(defaults), [defaults]);
  const field = useCallback(
    <K extends keyof T>(name: K) => ({
      id: idPrefix !== undefined ? `${idPrefix}-${String(name)}` : String(name),
      name: String(name),
      value: draft[name],
      onChange: (v: T[K]) => setDraft((d) => ({ ...d, [name]: v })),
    }),
    [draft, idPrefix],
  );
  return { draft, loadedKey, patch, reset, field };
}
