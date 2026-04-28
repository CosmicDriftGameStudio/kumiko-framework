// Generic Action-Menu — Trigger + Items, auf @radix-ui/react-dropdown-
// menu basiert. Wird benutzt für ProfileMenu (Topbar-Avatar), Edit-
// Header-Menu (Three-Dots), List-Row-Kebab — die Mechanik ist überall
// dieselbe, nur der Trigger unterscheidet sich.
//
// Nicht zu verwechseln mit RowActionsCell (siehe primitives/index.tsx),
// die hat die rowActions-Schema-API + per-row Visibility-Logik. Hier
// ist der Layer drunter: stable, schema-frei, callable von App-Code
// und vom Schema-Renderer (KumikoApp).
//
// Items sind Discriminated Union (item / separator / label), Item kann
// optional einen Keyboard-Shortcut-Hint rechts tragen (Linear-Pattern
// "O then M") + Icon links + variant für danger-styling.

import { type ReactNode, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export type MenuItemDef =
  | {
      readonly kind: "item";
      readonly id: string;
      readonly label: string;
      /** Optional Icon links vor dem Label (16px). */
      readonly icon?: ReactNode;
      /** Pure-display Shortcut-Hint rechts (monospace, gedimmt).
       *  Caller registriert den Shortcut separat — Linear-Style
       *  Strings wie "O then M", "Alt + Q", "⌘K". */
      readonly shortcut?: string;
      readonly onSelect: () => void;
      readonly disabled?: boolean;
      /** "danger" rendert Label rot — typisch Sign-out, Delete. */
      readonly variant?: "default" | "danger";
    }
  | { readonly kind: "separator" }
  | { readonly kind: "label"; readonly label: string };

export type ActionMenuProps = {
  /** Free-form Trigger-Component — Avatar, IconButton, Pill, Custom. */
  readonly trigger: ReactNode;
  /** aria-label für den Trigger-Wrapper. */
  readonly triggerLabel?: string;
  readonly items: readonly MenuItemDef[];
  /** Wo das Popup relativ zum Trigger anchorn soll. Default: end. */
  readonly align?: "start" | "center" | "end";
  /** Min-width für den Content. Default: 14rem. */
  readonly minWidth?: string;
  readonly testId?: string;
};

export function ActionMenu({
  trigger,
  triggerLabel,
  items,
  align = "end",
  minWidth = "14rem",
  testId,
}: ActionMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={testId ?? "action-menu-trigger"}
          {...(triggerLabel !== undefined && { "aria-label": triggerLabel })}
          className="rounded outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {trigger}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} style={{ minWidth }}>
        {items.map((item, idx) => {
          if (item.kind === "separator") {
            // biome-ignore lint/suspicious/noArrayIndexKey: Separators haben keine ID — Reihenfolge ist Identität
            return <DropdownMenuSeparator key={`sep-${idx}`} />;
          }
          if (item.kind === "label") {
            // biome-ignore lint/suspicious/noArrayIndexKey: gleicher Grund wie separator
            return <DropdownMenuLabel key={`label-${idx}`}>{item.label}</DropdownMenuLabel>;
          }
          return (
            <DropdownMenuItem
              key={item.id}
              onSelect={item.onSelect}
              disabled={item.disabled === true}
              data-testid={`action-menu-item-${item.id}`}
              className={
                item.variant === "danger" ? "text-destructive focus:text-destructive" : undefined
              }
            >
              {item.icon !== undefined && <span className="size-4 shrink-0">{item.icon}</span>}
              <span className="flex-1">{item.label}</span>
              {item.shortcut !== undefined && (
                <span className="ml-auto text-xs text-muted-foreground tracking-wider font-mono">
                  {item.shortcut}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
