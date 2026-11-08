import { createContext, useContext } from "react";

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
