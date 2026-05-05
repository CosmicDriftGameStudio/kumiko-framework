// @runtime client
// Standard-Topbar-Actions Komposition für Apps mit Auth + Workspaces.
// Bündelt das Pattern das jeder App-Sample sonst hand-ausschreibt:
// TenantSwitcher (links) → optional Extras (z.B. LanguageSwitcher) →
// ThemeToggle → UserMenu (rechts). Apps mit eigener Anordnung
// importieren weiter die Einzelkomponenten direkt — DefaultTopbarActions
// ist Convenience, kein Muss.

import { ThemeToggle } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { TenantSwitcher } from "./tenant-switcher";
import { UserMenu } from "./user-menu";

export type DefaultTopbarActionsProps = {
  /** Mapped Tenant-ID auf einen sprechenden Namen (z.B. branded label
   *  pro Tenant). TenantSwitcher's Default zeigt sonst die ersten 8
   *  Zeichen der UUID. */
  readonly tenantName?: (tenantId: string) => string;
  /** Slot zwischen TenantSwitcher und ThemeToggle. Typischer Use-Case:
   *  LanguageSwitcher pro App. ReactNode (nicht Array) damit die App
   *  selbst Reihenfolge + Spacing bestimmt. */
  readonly extras?: ReactNode;
  /** Light-Mode-Icon im ThemeToggle. Default: Unicode ☀. Apps die
   *  Lucide-Icons o.ä. wollen, übergeben ein eigenes Icon-Element. */
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
