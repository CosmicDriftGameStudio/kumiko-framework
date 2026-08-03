// AppShell mit Brand + Sidebar-Actions (TenantSwitcher + Theme +
// LanguageSwitcher + UserMenu via DefaultTopbarActions). Tenant-Name-
// Mapping bleibt im Shell — App-spezifische Logik, kein Framework-
// Konzept.

import { DefaultTopbarActions } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import {
  type AppSchema,
  DefaultAppShell,
  LanguageSwitcher,
} from "@cosmicdrift/kumiko-renderer-web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { BETA_TENANT_ID, DEV_TENANT_ID } from "./auth-constants";

const APP_NAME = "Kumiko Walkthrough";

const tenantName = (tenantId: string): string => {
  if (tenantId === DEV_TENANT_ID) return "Dev Tenant";
  if (tenantId === BETA_TENANT_ID) return "Beta Tenant";
  return tenantId.slice(0, 8);
};

const availableLocales = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
];

// Logo-Kachel + Wortmarke — wie SidebarBrand (sidebar-brand.tsx). Die
// Kachel bleibt collapsed stehen (liest sich als Logo, nicht als
// zufaelliger Buchstabe), nur die Wortmarke daneben blendet aus.
const Brand = (): ReactNode => (
  <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
    <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
      <span className="text-sm font-semibold">{APP_NAME.charAt(0)}</span>
    </div>
    <strong className="truncate text-foreground tracking-tight group-data-[collapsible=icon]:hidden">
      {APP_NAME}
    </strong>
  </div>
);

export function AppShell({
  children,
  schema,
}: {
  readonly children: ReactNode;
  readonly schema: AppSchema;
}): ReactNode {
  return (
    <DefaultAppShell
      brand={<Brand />}
      schema={schema}
      sidebarActions={
        <DefaultTopbarActions
          tenantName={tenantName}
          extras={<LanguageSwitcher locales={availableLocales} />}
          lightIcon={<Sun className="h-4 w-4" />}
          darkIcon={<MoonStar className="h-4 w-4" />}
        />
      }
    >
      {children}
    </DefaultAppShell>
  );
}
