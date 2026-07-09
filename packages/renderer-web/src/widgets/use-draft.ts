import { useCallback, useState } from "react";

/** Formular-State für Rechner-Screens: ein Draft-Objekt + `patch` für
 *  Teil-Updates + `field(name)` das die `{ id, name, value, onChange }`-Props
 *  fertig für die Feld-Widgets (NumberField/MoneyField/PercentField) liefert.
 *  Ersetzt das pro Screen wiederholte Draft-Interface + patch-Helper. */
export function useDraft<T extends object>(
  defaults: T,
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
  const [draft, setDraft] = useState<T>(defaults);
  const patch = useCallback((changes: Partial<T>) => setDraft((d) => ({ ...d, ...changes })), []);
  const reset = useCallback(() => setDraft(defaults), [defaults]);
  const field = useCallback(
    <K extends keyof T>(name: K) => ({
      id: String(name),
      name: String(name),
      value: draft[name],
      onChange: (v: T[K]) => setDraft((d) => ({ ...d, [name]: v })),
    }),
    [draft],
  );
  return { draft, patch, reset, field };
}
