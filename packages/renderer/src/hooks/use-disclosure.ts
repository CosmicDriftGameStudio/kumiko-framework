import { useCallback, useState } from "react";

// Open/close state for dialogs, sheets and collapsibles — the standard
// replacement for the hand-rolled `useState(false)` + toggle-callback
// trio in app screens. All callbacks are referentially stable.

export type UseDisclosureResult = {
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onToggle: () => void;
};

export function useDisclosure(initialOpen = false): UseDisclosureResult {
  const [open, setOpen] = useState(initialOpen);
  const onOpen = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);
  const onToggle = useCallback(() => setOpen((prev) => !prev), []);
  return { open, onOpen, onClose, onToggle };
}
