// TenantSwitcher — compact dropdown showing the active tenant and
// allowing switches to other memberships. Uses Radix-DropdownMenu for
// consistent click-outside, Escape, and keyboard-navigation behavior.
//
// Does NOT render when no user is logged in or when the user has only one
// tenant (single-tenant apps do not need a switcher).
//
// The display name comes from the optional `tenantName` prop or falls back
// to the ID hash. Design decision: TenantSwitcher does NOT fetch
// tenant:query:me itself, which would cost round trips per mount and
// require query-caching infrastructure. Instead, the host passes in the
// resolver (for example, from a useTenantNames() hook loaded once at app
// boot).

import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import {
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@cosmicdrift/kumiko-renderer/web";
import { Building2, ChevronDown } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { useSession } from "./session.tsx";

export type TenantSwitcherProps = {
  /** Optional: provides a human-readable name for each tenant ID.
   *  Default: displays the ID directly (a short UUID is sufficient for
   *  development environments). In production, the host should cache
   *  tenant names at login and pass them here. */
  readonly tenantName?: (tenantId: string) => string;
};

export function TenantSwitcher({ tenantName }: TenantSwitcherProps): ReactNode {
  const t = useTranslation();
  const { user, tenants, activeTenantId, switchTenant } = useSession();
  const [switching, setSwitching] = useState<string | null>(null);

  const handleSwitch = useCallback(
    async (tenantId: string) => {
      if (tenantId === activeTenantId) return;
      setSwitching(tenantId);
      try {
        await switchTenant(tenantId);
      } finally {
        // In practice, switchTenant causes a full-page reload, so we never see
        // the cleared state — `finally` only handles the edge case where
        // switchTenant throws, preventing the UI from remaining stuck with
        // the spinner.
        setSwitching(null);
      }
    },
    [activeTenantId, switchTenant],
  );

  // Label priority: app-provided resolver (prop) > server-provided
  // name/key from /auth/tenants > UUID prefix. The latter is only a
  // last resort — it is indistinguishable for seeded tenants (00000000-…).
  const nameOf = (tenantId: string): string => {
    if (tenantName !== undefined) return tenantName(tenantId);
    const membership = tenants.find((m) => m.tenantId === tenantId);
    // || instead of ??: an empty name/key string must not be used as a label.
    return membership?.name || membership?.key || tenantId.slice(0, 8);
  };

  // Rendering gate: no user → nothing; only one tenant → nothing as well
  // (single-tenant apps do not need a switcher).
  if (user === null || tenants.length <= 1) return null;

  const activeLabel =
    activeTenantId !== null ? nameOf(activeTenantId) : t("auth.tenant.switcher.none");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* kumiko-lint-ignore primitives-discipline radix-asChild requires a DOM element as the trigger; Native has its own .native.tsx variant with ActionSheet */}
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-md border border-input bg-background px-2 py-1 text-sm",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        >
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="max-w-[14ch] truncate">{activeLabel}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel>{t("auth.tenant.switcher.label")}</DropdownMenuLabel>
        {tenants.map((membership) => {
          const isActive = membership.tenantId === activeTenantId;
          const isSwitching = switching === membership.tenantId;
          return (
            <DropdownMenuCheckboxItem
              key={membership.tenantId}
              checked={isActive}
              disabled={isSwitching}
              onSelect={(e) => {
                e.preventDefault();
                void handleSwitch(membership.tenantId);
              }}
            >
              <div className="flex flex-col items-start min-w-0">
                <span className="truncate font-medium">{nameOf(membership.tenantId)}</span>
                {membership.roles.length > 0 && (
                  <span className="text-xs text-muted-foreground truncate">
                    {membership.roles.join(", ")}
                  </span>
                )}
              </div>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
