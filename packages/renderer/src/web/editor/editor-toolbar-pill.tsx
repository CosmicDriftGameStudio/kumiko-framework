import type { ReactNode } from "react";

// A compact outlined pill for a second toolbar row; a select button inside stays flat and fills the pill.
export function EditorToolbarPill({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <span className="inline-flex h-7 shrink-0 items-center rounded-md border border-input bg-background [&_button]:h-full [&_button]:min-h-0 [&_button[aria-haspopup=listbox]]:h-full [&_button[aria-haspopup=listbox]]:min-h-0 [&_button[aria-haspopup=listbox]]:w-auto [&_button[aria-haspopup=listbox]]:px-2 [&_button[aria-haspopup=listbox]]:py-0 [&_button[aria-haspopup=listbox]]:text-xs">
      {children}
    </span>
  );
}
