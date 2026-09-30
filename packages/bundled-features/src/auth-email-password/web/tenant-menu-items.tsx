// @runtime client
// Tenant choices as dropdown entries — the TenantSwitcher's list for a user
// menu that carries the shell controls. Renders nothing for a single tenant.

import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { useSession } from "./session.js";

export type TenantMenuItemsProps = {
  readonly tenantName?: (tenantId: string) => string;
};

export function TenantMenuItems({ tenantName }: TenantMenuItemsProps): ReactNode {
  const t = useTranslation();
  const { user, tenants, activeTenantId, switchTenant } = useSession();
  if (user === null || tenants.length <= 1) return null;

  const nameOf = (tenantId: string): string => {
    if (tenantName !== undefined) return tenantName(tenantId);
    const membership = tenants.find((m) => m.tenantId === tenantId);
    return membership?.name || membership?.key || tenantId.slice(0, 8);
  };

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
          <span className="truncate">{nameOf(membership.tenantId)}</span>
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
    </>
  );
}
