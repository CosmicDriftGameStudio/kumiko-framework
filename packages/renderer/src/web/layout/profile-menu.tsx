// Profile menu — a thin wrapper around ActionMenu (see primitives/
// action-menu.tsx). The trigger is always an avatar; everything else
// (items, separators, shortcut hints, and the danger variant) comes
// from the generic ActionMenu. For another trigger (three-dot icon,
// pill, or custom button), use ActionMenu directly.
//
// ProfileMenuItem aliases MenuItemDef so existing caller code remains
// type-safe without duplicating the discriminated union.
//
// Linear pattern: a compact avatar pill that opens a menu with View
// Profile / Settings / Sign-out and optional keyboard shortcut hints.

import type { ReactNode } from "react";
import { ActionMenu, type MenuItemDef } from "../primitives/action-menu.tsx";
import { Avatar } from "./avatar.tsx";

export type ProfileMenuItem = MenuItemDef;

export type ProfileMenuProps = {
  readonly user: {
    readonly id: string;
    /** Display name or email — the source for initials. */
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
