import type { RowAction } from "@cosmicdrift/kumiko-framework/ui-types";
import { createContext, useContext, useEffect, useId } from "react";

/** What an action with `submitWith` needs from the writeForm it submits: validate first,
 *  read the current values into its own payload, reset the dirty state after the write. */
export type WriteFormHandle = {
  readonly validate: () => boolean;
  /** Labels of the fields that failed the last `validate()`, for a message when the form itself is not visible. */
  readonly invalidFieldLabels: () => readonly string[];
  readonly getValues: () => Readonly<Record<string, unknown>>;
  readonly rebase: () => void;
};

/** Mounted writeForm sections by the id of the action that submits them (`submitWith`). */
export type WriteFormRegistry = Map<string, WriteFormHandle>;

const WriteFormRegistryContext = createContext<WriteFormRegistry | null>(null);

export const WriteFormRegistryProvider = WriteFormRegistryContext.Provider;

export function useWriteFormRegistry(): WriteFormRegistry | null {
  return useContext(WriteFormRegistryContext);
}

/** Tells the host which writeForm sections hold unsaved input, so its other actions can ask before
 *  a reload drops it. */
export type WriteFormDirtyReporter = (formKey: string, dirty: boolean) => void;

const WriteFormDirtyReporterContext = createContext<WriteFormDirtyReporter | null>(null);

export const WriteFormDirtyReporterProvider = WriteFormDirtyReporterContext.Provider;

/** Dirty key of a footer form: several actions send it, so no single action id can stand for it. */
export const FOOTER_WRITE_FORM_DIRTY_KEY = "write-form-footer";

/** `submitWith` doubles as the key, so the host can tell which action would send this input. */
export function useReportWriteFormDirty(dirty: boolean, submitWith?: string): void {
  const report = useContext(WriteFormDirtyReporterContext);
  const ownKey = useId();
  const formKey = submitWith ?? ownKey;
  useEffect(() => {
    if (report === null) return;
    report(formKey, dirty);
    return () => report(formKey, false);
  }, [report, formKey, dirty]);
}

/** Ids of the writeHandler actions of a footer form: each one sends the form's values with its own payload. */
export function footerSubmitActionIds(
  actions: readonly RowAction[] | undefined,
): readonly string[] {
  return (actions ?? [])
    .filter((action) => action.kind === undefined || action.kind === "writeHandler")
    .map((action) => action.id);
}
