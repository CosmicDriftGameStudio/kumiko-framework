// @runtime client
// TenantSwitcher — kleines Dropdown, zeigt den aktiven Tenant und
// erlaubt Wechsel zu anderen Memberships. Auf Radix-DropdownMenu für
// konsistentes Verhalten (Click-outside/Escape/Keyboard-Nav).
//
// Rendert NICHT wenn kein User eingeloggt ist und auch NICHT wenn der
// User nur einen Tenant hat (Single-Tenant-Apps brauchen keinen
// Switcher).
//
// Der Display-Name kommt aus einem optionalen `tenantName`-Prop
// oder fallback zum ID-Hash. Design-Entscheidung: der TenantSwitcher
// holt NICHT selbst tenant:query:me — das würde Round-Trips pro Mount
// kosten und bräuchte Query-Caching-Infrastruktur. Stattdessen reicht
// der Host den Resolver rein (kommt z.B. aus einer useTenantNames()-
// Hook die einmalig am App-Boot geladen wird).

import { useTranslation } from "@kumiko/renderer";
import {
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@kumiko/renderer-web";
import { Building2, ChevronDown } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { useSession } from "./session";

export type TenantSwitcherProps = {
  /** Optional: liefert einen menschenlesbaren Namen pro Tenant-ID.
   *  Default: die ID wird direkt angezeigt (kurze UUID genügt für
   *  Dev-Umgebungen). Für prod sollte der Host z.B. die Tenant-Namen
   *  beim Login cachen und hier durchreichen. */
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
        // In der Praxis führt switchTenant zu einem full-page reload,
        // also sehen wir den cleared-state nie — das `finally` ist nur
        // für den Edge-Case dass switchTenant throwt, damit die UI
        // nicht mit dem Spinner hängen bleibt.
        setSwitching(null);
      }
    },
    [activeTenantId, switchTenant],
  );

  const nameOf = (tenantId: string): string =>
    tenantName !== undefined ? tenantName(tenantId) : tenantId.slice(0, 8);

  // Rendering-Gate: kein User → nix; nur ein Tenant → auch nix
  // (Single-Tenant-Apps brauchen keinen Switcher).
  if (user === null || tenants.length <= 1) return null;

  const activeLabel =
    activeTenantId !== null ? nameOf(activeTenantId) : t("auth.tenant.switcher.none");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* kumiko-lint-ignore primitives-discipline radix-asChild braucht DOM-Element als Trigger; Native kriegt eigene .native.tsx-Variante mit ActionSheet */}
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
