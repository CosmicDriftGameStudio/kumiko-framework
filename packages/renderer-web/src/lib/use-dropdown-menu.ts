// Dropdown-Mechanik für Menus die ohne Radix auskommen: click-outside
// schließt, Escape schließt. Konsumenten halten ihren eigenen open-
// State und reichen einen Container-Ref rein. Drei Konsumenten heute
// (UserMenu, TenantSwitcher, LanguageSwitcher) hatten denselben
// useEffect dreimal kopiert — der Hook konsolidiert das.

import { type RefObject, useEffect } from "react";

export type UseDropdownMenuOptions = {
  /** Ref auf den Container der den Trigger UND das Popup umschließt.
   *  Klicks innerhalb (auf Trigger oder Menüeinträge) schließen NICHT;
   *  alles außerhalb triggert onClose. */
  readonly containerRef: RefObject<HTMLElement | null>;
  /** Aktueller Open-State. Wenn false, sind die Listener inaktiv. */
  readonly open: boolean;
  /** Wird aufgerufen bei click-outside oder Escape. Caller setzt
   *  damit den eigenen open-State auf false. */
  readonly onClose: () => void;
};

export function useDropdownMenu({ containerRef, open, onClose }: UseDropdownMenuOptions): void {
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      const node = containerRef.current;
      if (node === null) return;
      if (!node.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, containerRef]);
}
