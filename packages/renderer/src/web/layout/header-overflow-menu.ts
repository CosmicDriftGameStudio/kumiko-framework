import { createContext } from "react";

/** True for nodes rendered inside the phone header overflow menu, so controls
 *  like ThemeToggle can draw a labelled menu row instead of an icon button. */
export const HeaderOverflowMenuContext = createContext(false);

// Mirrors the DropdownMenuItem look in primitives/dropdown-menu.tsx, with a 40px touch target.
export const headerOverflowMenuItemClass =
  "relative flex min-h-10 w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm " +
  "outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground " +
  "disabled:pointer-events-none disabled:opacity-50";
