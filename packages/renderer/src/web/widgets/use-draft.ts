import { useCallback, useState } from "react";

/** Form state for calculator screens: a draft object plus `patch` for
 *  partial updates, and `field(name)` that provides `{ id, name, value, onChange }`
 *  props ready for field widgets (NumberField/MoneyField/PercentField).
 *  Replaces the repeated draft interface and patch helper in each screen.
 *  `idPrefix` prevents duplicate DOM `id`s when multiple `useDraft` forms with
 *  same-named fields are mounted on the same page; `name` remains the plain key
 *  for the form payload. */
export function useDraft<T extends object>(
  defaults: T,
  options?: { readonly idPrefix?: string },
): {
  readonly draft: T;
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
  const [draft, setDraft] = useState<T>(defaults);
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
  return { draft, patch, reset, field };
}
