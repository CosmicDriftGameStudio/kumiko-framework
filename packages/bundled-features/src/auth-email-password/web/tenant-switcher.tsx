// TenantSwitcher — kleines Dropdown, zeigt den aktiven Tenant und
// erlaubt Wechsel zu anderen Memberships. Rendert NICHT wenn der User
// nur einen Tenant hat (Single-Tenant-Apps sehen keinen Noise im
// Topbar) und auch NICHT wenn kein User eingeloggt ist.
//
// Der aktive Tenant wird per TenantId identifiziert; der Display-Name
// kommt aus einem optionalen `tenantNameResolver`-Prop oder fallback
// zum ID-Hash. Design-Entscheidung: der TenantSwitcher holt NICHT
// selbst tenant:query:me — das würde Round-Trips pro Mount kosten und
// bräuchte Query-Caching-Infrastruktur. Stattdessen reicht der Host
// den Resolver rein (kommt z.B. aus einer useTenantNames()-Hook die
// einmalig am App-Boot geladen wird).

import { useTranslation } from "@kumiko/renderer";
import { cn, useDropdownMenu } from "@kumiko/renderer-web";
import { Building2, Check, ChevronDown } from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useDropdownMenu({ containerRef, open, onClose: () => setOpen(false) });

  const handleSwitch = useCallback(
    async (tenantId: string) => {
      if (tenantId === activeTenantId) {
        setOpen(false);
        return;
      }
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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
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
      {open && (
        <div
          role="menu"
          aria-label={t("auth.tenant.switcher.label")}
          className={cn(
            "absolute right-0 z-50 mt-1 min-w-[14rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
            "animate-in fade-in-0 zoom-in-95",
          )}
        >
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {t("auth.tenant.switcher.label")}
          </div>
          {tenants.map((membership) => {
            const isActive = membership.tenantId === activeTenantId;
            const isSwitching = switching === membership.tenantId;
            return (
              <button
                key={membership.tenantId}
                type="button"
                role="menuitem"
                onClick={() => handleSwitch(membership.tenantId)}
                disabled={isSwitching}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:bg-accent",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                <div className="flex flex-col items-start min-w-0">
                  <span className="truncate font-medium">{nameOf(membership.tenantId)}</span>
                  {membership.roles.length > 0 && (
                    <span className="text-xs text-muted-foreground truncate">
                      {membership.roles.join(", ")}
                    </span>
                  )}
                </div>
                {isActive && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
