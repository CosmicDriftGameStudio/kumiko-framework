import { useCallback, useEffect, useState } from "react";
import type {
  WriteFormDirtyReporter,
  WriteFormRegistry,
} from "../components/write-form-registry.ts";

/** writeForm sections register here so an action with `submitWith` can send their values; their
 *  dirty state is reported to the host (a drawer asks before closing). */
export function useWriteFormTracking(onDirtyChange: ((dirty: boolean) => void) | undefined): {
  readonly writeForms: WriteFormRegistry;
  readonly dirtyWriteForms: ReadonlySet<string>;
  readonly reportWriteFormDirty: WriteFormDirtyReporter;
} {
  const [writeForms] = useState<WriteFormRegistry>(() => new Map());
  const [dirtyWriteForms, setDirtyWriteForms] = useState<ReadonlySet<string>>(() => new Set());
  const reportWriteFormDirty = useCallback<WriteFormDirtyReporter>((formKey, dirty) => {
    setDirtyWriteForms((current) => {
      if (current.has(formKey) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(formKey);
      else next.delete(formKey);
      return next;
    });
  }, []);
  const anyWriteFormDirty = dirtyWriteForms.size > 0;
  useEffect(() => {
    onDirtyChange?.(anyWriteFormDirty);
  }, [anyWriteFormDirty, onDirtyChange]);
  return { writeForms, dirtyWriteForms, reportWriteFormDirty };
}
