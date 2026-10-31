// Tenant choices as dropdown entries — the TenantSwitcher's list for a user
// menu that carries the shell controls. Renders nothing for a single tenant.

import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import { useSession } from "./session.tsx";
import { tenantLabel } from "./tenant-label.ts";

export type TenantMenuItemsProps = {
  readonly tenantName?: (tenantId: string) => string;
};

export function TenantMenuItems({ tenantName }: TenantMenuItemsProps): ReactNode {
  const t = useTranslation();
  const { user, tenants, activeTenantId, switchTenant } = useSession();
  if (user === null || tenants.length <= 1) return null;

  return (
    <>
      <DropdownMenuLabel>{t("auth.tenant.switcher.label")}</DropdownMenuLabel>
      {tenants.map((membership) => (
        <DropdownMenuCheckboxItem
          key={membership.tenantId}
          checked={membership.tenantId === activeTenantId}
          onSelect={(event) => {
            event.preventDefault();
            if (membership.tenantId !== activeTenantId) void switchTenant(membership.tenantId);
          }}
        >
          <span className="truncate">{tenantLabel(tenants, membership.tenantId, tenantName)}</span>
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
    </>
  );
}
