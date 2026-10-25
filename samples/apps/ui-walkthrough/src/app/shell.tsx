// AppShell with brand and user menu in the sidebar footer. Tenant, language and
// theme choice live in the user menu. Tenant name mapping stays in the shell —
// app-specific logic, not a framework concept.

import {
  TenantMenuItems,
  UserMenu,
  useSession,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import {
  type AppSchema,
  DefaultAppShell,
  LanguageMenuItems,
  SidebarBrand,
  ThemeMenuItem,
  ThemeToggle,
  useNav,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer/web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { AssistantAction } from "./assistant-action";
import {
  BETA_TENANT_ID,
  DEV_TENANT_ID,
  NORDLICHT_TENANT_ID,
  NORDLICHT_TENANT_NAME,
} from "./auth-constants";
import { HelpAction } from "./help-action";

const APP_NAME = "Kumiko Walkthrough";
const HELP_SCREEN_ID = "vehicle-edit";

const tenantName = (tenantId: string): string => {
  if (tenantId === DEV_TENANT_ID) return "Dev Tenant";
  if (tenantId === BETA_TENANT_ID) return "Beta Tenant";
  if (tenantId === NORDLICHT_TENANT_ID) return NORDLICHT_TENANT_NAME;
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
  const session = useSession();
  const nav = useNav();
  // Without the user the shell hides role-gated navs and KumikoScreen denies role-gated screens.
  const user = session.user !== null ? { id: session.user.id, roles: session.roles } : undefined;
  return (
    <DefaultAppShell
      brand={<SidebarBrand name={APP_NAME} plan={t("tasks.shell.tagline")} />}
      schema={schema}
      {...(user !== undefined && { user })}
      headerActions={
        <>
          {/* Only here: the editor screens need the header width for their own actions. */}
          {nav.route?.screenId === HELP_SCREEN_ID && <HelpAction />}
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
