// Generic action menu built on @radix-ui/react-dropdown-
// menu. Used for ProfileMenu (topbar avatar), Edit-
// Header-Menu (three dots), and list-row kebab menus; only the
// trigger differs between uses.
//
// Unlike RowActionsCell (see primitives/index.tsx), this is a
// stable, schema-free layer callable from app code and the schema
// renderer (KumikoApp), without the rowActions schema or per-row
// visibility logic.
//
// Items form a discriminated union (item / separator / label). Items
// can optionally display a keyboard-shortcut hint on the right
// (Linear-style strings such as "O then M"), an icon on the left,
// and a variant for danger styling.

import { type ReactNode, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";

export type MenuItemDef =
  | {
      readonly kind: "item";
      readonly id: string;
      readonly label: string;
      /** Optional icon displayed before the label (16px). */
      readonly icon?: ReactNode;
      /** Display-only shortcut hint on the right (monospace, muted).
       * The caller registers the shortcut separately; Linear-style
       * strings include "O then M", "Alt + Q", and "⌘K". */
      readonly shortcut?: string;
      readonly onSelect: () => void;
      readonly disabled?: boolean;
      /** "danger" renders the label in red, typically for sign-out or delete actions. */
      readonly variant?: "default" | "danger";
    }
  | { readonly kind: "separator" }
  | { readonly kind: "label"; readonly label: string };

export type ActionMenuProps = {
  /** Free-form Trigger-Component — Avatar, IconButton, Pill, Custom. */
  readonly trigger: ReactNode;
  /** aria-label for the trigger wrapper. */
  readonly triggerLabel?: string;
  readonly items: readonly MenuItemDef[];
  /** Where to anchor the popup relative to the trigger. Default: end. */
  readonly align?: "start" | "center" | "end";
  /** Minimum width for the content. Default: 14rem. */
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
            // biome-ignore lint/suspicious/noArrayIndexKey: Separators have no ID, so their position provides identity
            return <DropdownMenuSeparator key={`sep-${idx}`} />;
          }
          if (item.kind === "label") {
            // biome-ignore lint/suspicious/noArrayIndexKey: Separators have no ID, so their position provides identity
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
