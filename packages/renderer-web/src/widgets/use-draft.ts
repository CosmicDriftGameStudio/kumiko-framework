import { useCallback, useState } from "react";

/** Formular-State für Rechner-Screens: ein Draft-Objekt + `patch` für
 *  Teil-Updates + `field(name)` das die `{ id, name, value, onChange }`-Props
 *  fertig für die Feld-Widgets (NumberField/MoneyField/PercentField) liefert.
 *  Ersetzt das pro Screen wiederholte Draft-Interface + patch-Helper.
 *  `idPrefix` verhindert doppelte DOM-`id`s, wenn mehrere `useDraft`-Formulare
 *  mit gleichnamigen Feldern auf derselben Seite gemountet werden — `name`
 *  bleibt der reine Key fürs Form-Payload. */
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
