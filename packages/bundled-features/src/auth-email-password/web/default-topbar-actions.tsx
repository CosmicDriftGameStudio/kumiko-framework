// Composes the standard top-bar actions for apps with auth and workspaces.
// This bundles the pattern that each app sample would otherwise write by hand:
// TenantSwitcher (left) → optional extras (for example, LanguageSwitcher) →
// ThemeToggle → UserMenu (right). Apps with a custom arrangement can still
// import the individual components directly; DefaultTopbarActions is
// convenience, not a requirement.

import { ThemeToggle } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import { TenantSwitcher } from "./tenant-switcher.tsx";
import { UserMenu } from "./user-menu.tsx";

export type DefaultTopbarActionsProps = {
  /** Maps a tenant ID to a human-readable name (for example, a branded label
   *  per tenant). TenantSwitcher's default otherwise displays the first 8
   *  characters of the UUID. */
  readonly tenantName?: (tenantId: string) => string;
  /** Slot between TenantSwitcher and ThemeToggle. Typical use case:
   *  an app-specific LanguageSwitcher. ReactNode, rather than an array, so the
   *  app controls the ordering and spacing. */
  readonly extras?: ReactNode;
  /** Light-mode icon for ThemeToggle. Default: Unicode ☀. Apps that want
   *  Lucide icons or similar can provide a custom icon element. */
  readonly lightIcon?: ReactNode;
  /** Dark-Mode-Icon. Default: Unicode ☾. */
  readonly darkIcon?: ReactNode;
};

export function DefaultTopbarActions({
  tenantName,
  extras,
  lightIcon,
  darkIcon,
}: DefaultTopbarActionsProps = {}): ReactNode {
  return (
    <div className="flex items-center gap-2">
      <TenantSwitcher {...(tenantName !== undefined && { tenantName })} />
      {extras}
      <ThemeToggle
        {...(lightIcon !== undefined && { lightIcon })}
        {...(darkIcon !== undefined && { darkIcon })}
      />
      <UserMenu />
    </div>
  );
}
