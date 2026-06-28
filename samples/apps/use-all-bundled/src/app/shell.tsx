import { DefaultTopbarActions } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import {
  type AppSchema,
  DefaultAppShell,
  LanguageSwitcher,
} from "@cosmicdrift/kumiko-renderer-web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { BETA_TENANT_ID, DEV_TENANT_ID } from "./auth-constants";

const APP_NAME = "Kumiko — All Features";

const tenantName = (tenantId: string): string => {
  if (tenantId === DEV_TENANT_ID) return "Dev Tenant";
  if (tenantId === BETA_TENANT_ID) return "Beta Tenant";
  return tenantId.slice(0, 8);
};

const availableLocales = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
];

const Brand = (): ReactNode => (
  <strong className="text-foreground tracking-tight">{APP_NAME}</strong>
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
