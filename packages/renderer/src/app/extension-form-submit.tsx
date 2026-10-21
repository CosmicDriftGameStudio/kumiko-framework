// @runtime client
// Extension-Form-Submit-Registry — lets an extension section (e.g.
// Custom-Fields) write during submission of the surrounding entityEdit form
// instead of maintaining its own Save button ("composed form, one save").
// The section reports (a) a submit handler and (b) its dirty state to the form;
// the form enables its Save button even when only one section is dirty and,
// after the entity write, calls all section handlers with the entityId.
//
// Without a surrounding form (Context === null), the section falls back to its
// own Save button (Standalone-Backward-Compat).

import { createContext, useContext, useEffect, useId, useMemo, useRef } from "react";

export type ExtensionSubmitContext = { readonly entityId: string };

export type ExtensionSubmitResult = {
  readonly isSuccess: boolean;
  /** i18n key for the error message that the form displays as a banner. */
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

// Host side (render-edit): keeps registrations in a ref, reports the
// aggregated dirty state through onDirtyChange so the Save button re-renders,
// and provides runAll() to execute all handlers on submission.
export type ExtensionFormHostStatus = {
  readonly anyDirty: boolean;
  readonly hasRegistrations: boolean;
};

export function useExtensionFormHost(onStatusChange: (status: ExtensionFormHostStatus) => void): {
  readonly registry: ExtensionFormRegistry;
  readonly runAll: (ctx: ExtensionSubmitContext) => Promise<readonly ExtensionSubmitResult[]>;
} {
  const regsRef = useRef<Map<string, Registration>>(new Map());
  const onStatusRef = useRef(onStatusChange);
  onStatusRef.current = onStatusChange;

  const registry = useMemo<ExtensionFormRegistry>(() => {
    const emitDirty = (): void => {
      let any = false;
      for (const r of regsRef.current.values()) {
        if (r.dirty) {
          any = true;
          break;
        }
      }
      onStatusRef.current({ anyDirty: any, hasRegistrations: regsRef.current.size > 0 });
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

// Section side: reports the handler and dirty state to the surrounding form.
// Returns true when a composed form is present, so the section hides its own
// Save button; false means standalone, so its own Save button remains.
export function useExtensionFormSubmit(opts: {
  readonly dirty: boolean;
  readonly onSubmit: ExtensionFormSubmitHandler;
}): boolean {
  const registry = useContext(ExtensionFormRegistryContext);
  const key = useId();
  // The ref prevents re-registration whenever the handler identity changes
  // (only dirty triggers it); the handler always reads the latest closure state
  // (pending) when invoked.
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
