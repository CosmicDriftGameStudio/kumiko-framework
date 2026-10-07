// AppShell mit Brand und User-Menü im Sidebar-Footer. Tenant-, Sprach- und
// Theme-Wahl hängen im User-Menü. Tenant-Name-Mapping bleibt im Shell —
// App-spezifische Logik, kein Framework-Konzept.

import {
  TenantMenuItems,
  UserMenu,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import {
  type AppSchema,
  DefaultAppShell,
  LanguageMenuItems,
  SidebarBrand,
  ThemeMenuItem,
  ThemeToggle,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer-web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { AssistantAction } from "./assistant-action";
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

export function AppShell({
  children,
  schema,
}: {
  readonly children: ReactNode;
  readonly schema: AppSchema;
}): ReactNode {
  const t = useTranslation();
  return (
    <DefaultAppShell
      brand={<SidebarBrand name={APP_NAME} plan={t("tasks.shell.tagline")} />}
      schema={schema}
      headerActions={
        <>
          <AssistantAction />
          <ThemeToggle />
        </>
      }
      sidebarFooter={
        <UserMenu variant="sidebar">
          <TenantMenuItems tenantName={tenantName} />
          <LanguageMenuItems locales={availableLocales} />
          <ThemeMenuItem
            lightIcon={<Sun className="h-4 w-4" />}
            darkIcon={<MoonStar className="h-4 w-4" />}
          />
        </UserMenu>
      }
    >
      {children}
    </DefaultAppShell>
  );
}
