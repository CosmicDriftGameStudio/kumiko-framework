// Profile-Menu — dünner Wrapper über ActionMenu (siehe primitives/
// action-menu.tsx). Der Trigger ist immer ein Avatar; alles weitere
// (Items, Separators, Shortcut-Hints, Danger-Variant) kommt vom
// generischen ActionMenu. Wenn jemand einen anderen Trigger braucht
// (Three-Dots-Icon, Pill, Custom-Button), nimmt er ActionMenu direkt.
//
// ProfileMenuItem ist ein Alias für MenuItemDef — Bestehender Caller-
// Code bleibt typsicher, ohne dass wir den Discriminated-Union doppelt
// pflegen.
//
// Linear-Pattern: kompakter Avatar-Pill, Click öffnet Menü mit View-
// Profile / Settings / Sign-out + optional Keyboard-Shortcut-Hints.

import type { ReactNode } from "react";
import { ActionMenu, type MenuItemDef } from "../primitives/action-menu";
import { Avatar } from "./avatar";

export type ProfileMenuItem = MenuItemDef;

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
  return (
    <ActionMenu
      trigger={<Avatar id={user.id} label={user.label} size="md" />}
      triggerLabel={`Open ${user.label} menu`}
      items={items}
      align="end"
      testId={testId ?? "profile-menu-trigger"}
    />
  );
}
