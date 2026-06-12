// @runtime client
// Extension-Form-Submit-Registry — erlaubt einer Extension-Section (z.B.
// Custom-Fields), beim Submit des umgebenden entityEdit-Forms mitzuschreiben,
// statt einen eigenen Save-Button zu führen ("composed form, ein Save",
// Bug-Bash 3 #1). Die Section meldet (a) einen Submit-Handler und (b) ihren
// dirty-State an die Form; die Form aktiviert ihren Save-Button auch wenn nur
// eine Section dirty ist und ruft nach dem Entity-Write alle Section-Handler
// mit der entityId.
//
// Ohne umgebende Form (Context === null) fällt die Section auf ihren eigenen
// Save-Button zurück (Standalone-Backward-Compat).

import { createContext, useContext, useEffect, useId, useMemo, useRef } from "react";

export type ExtensionSubmitContext = { readonly entityId: string };

export type ExtensionSubmitResult = {
  readonly isSuccess: boolean;
  /** i18n-Key für die Fehlermeldung, die die Form als Banner zeigt. */
  readonly errorKey?: string;
};

export type ExtensionFormSubmitHandler = (
  ctx: ExtensionSubmitContext,
) => Promise<ExtensionSubmitResult>;

type Registration = {
  readonly key: string;
  readonly dirty: boolean;
  readonly handler: ExtensionFormSubmitHandler;
};

export type ExtensionFormRegistry = {
  readonly upsert: (reg: Registration) => void;
  readonly remove: (key: string) => void;
};

const ExtensionFormRegistryContext = createContext<ExtensionFormRegistry | null>(null);

export const ExtensionFormRegistryProvider = ExtensionFormRegistryContext.Provider;

// Host-Seite (render-edit): hält die Registrierungen in einem ref, meldet den
// aggregierten dirty-State via onDirtyChange hoch (damit der Save-Button
// re-rendert) und liefert runAll() zum Ausführen aller Handler beim Submit.
export function useExtensionFormHost(onDirtyChange: (anyDirty: boolean) => void): {
  readonly registry: ExtensionFormRegistry;
  readonly runAll: (ctx: ExtensionSubmitContext) => Promise<readonly ExtensionSubmitResult[]>;
} {
  const regsRef = useRef<Map<string, Registration>>(new Map());
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;

  const registry = useMemo<ExtensionFormRegistry>(() => {
    const emitDirty = (): void => {
      let any = false;
      for (const r of regsRef.current.values()) {
        if (r.dirty) {
          any = true;
          break;
        }
      }
      onDirtyRef.current(any);
    };
    return {
      upsert: (reg) => {
        regsRef.current.set(reg.key, reg);
        emitDirty();
      },
      remove: (key) => {
        regsRef.current.delete(key);
        emitDirty();
      },
    };
  }, []);

  const runAll = useMemo(
    () =>
      async (ctx: ExtensionSubmitContext): Promise<readonly ExtensionSubmitResult[]> => {
        const results: ExtensionSubmitResult[] = [];
        // Insertion-Order (Map) = Section-Reihenfolge im Form.
        for (const reg of regsRef.current.values()) {
          results.push(await reg.handler(ctx));
        }
        return results;
      },
    [],
  );

  return { registry, runAll };
}

// Section-Seite: meldet Handler + dirty an die umgebende Form. Returnt true
// wenn eine composed-Form vorhanden ist (Section blendet dann ihren eigenen
// Save-Button aus); false = standalone (eigener Save-Button bleibt).
export function useExtensionFormSubmit(opts: {
  readonly dirty: boolean;
  readonly onSubmit: ExtensionFormSubmitHandler;
}): boolean {
  const registry = useContext(ExtensionFormRegistryContext);
  const key = useId();
  // Handler über ref, damit das Re-Registrieren NICHT an jeder Handler-
  // Identity hängt (nur an dirty); der Handler liest immer den frischen
  // Closure-State (pending) zur Aufruf-Zeit.
  const handlerRef = useRef(opts.onSubmit);
  handlerRef.current = opts.onSubmit;

  useEffect(() => {
    if (registry === null) return;
    registry.upsert({
      key,
      dirty: opts.dirty,
      handler: (ctx) => handlerRef.current(ctx),
    });
    return () => registry.remove(key);
  }, [registry, key, opts.dirty]);

  return registry !== null;
}
