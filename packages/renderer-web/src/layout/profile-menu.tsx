// Profile-Menu — Avatar als Dropdown-Trigger, items vom Caller. Gehört
// in den Topbar-end-Slot (typischerweise rechts neben Theme-Toggle /
// Tenant-Switcher). Linear-Pattern: kompakter Avatar-Pill, Click
// öffnet Menü mit View-Profile / Settings / Sign-out + optional
// Keyboard-Shortcut-Hints rechts.
//
// Items sind Schema-flexibel — der Caller liefert Array<Item>; wir
// rendern Items + Separators + Shortcut-Hints (rechts, monospace,
// gedimmt). Click ruft `onSelect` auf; Radix kümmert sich um Close +
// Keyboard-Navigation.

import { type ReactNode, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../primitives/dropdown-menu";
import { Avatar } from "./avatar";

export type ProfileMenuItem =
  | {
      readonly kind: "item";
      readonly id: string;
      readonly label: string;
      /** Optionaler Keyboard-Shortcut-Hint rechts im Item. Pure-display
       *  (kein wiring) — der Caller registriert den Shortcut separat
       *  über sein App-Cmd-K-System. Linear zeigt das als "O then M",
       *  "Alt + Q" etc. — beliebige Strings. */
      readonly shortcut?: string;
      readonly onSelect: () => void;
      /** Visual-Style. "danger" rendert rot (Sign-out etc.). */
      readonly variant?: "default" | "danger";
    }
  | { readonly kind: "separator" }
  | { readonly kind: "label"; readonly label: string };

export type ProfileMenuProps = {
  readonly user: {
    readonly id: string;
    /** Display-Name oder Email — Quelle für Initials. */
    readonly label: string;
  };
  readonly items: readonly ProfileMenuItem[];
  readonly testId?: string;
};

export function ProfileMenu({ user, items, testId }: ProfileMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={testId ?? "profile-menu-trigger"}
          aria-label={`Open ${user.label} menu`}
          className="rounded outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Avatar id={user.id} label={user.label} size="md" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        {items.map((item, idx) => {
          if (item.kind === "separator") {
            // biome-ignore lint/suspicious/noArrayIndexKey: Separators haben keine ID — Reihenfolge ist die Identität
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
              data-testid={`profile-menu-item-${item.id}`}
              className={
                item.variant === "danger" ? "text-destructive focus:text-destructive" : undefined
              }
            >
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
