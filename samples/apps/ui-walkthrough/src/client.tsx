// Browser-Entrypoint. Bundled via Bun.build (server.ts).
//
// Was hier in der Datei steckt sind die App-spezifischen Entscheidungen
// die jede echte App auch treffen würde: Tenant-Name-Mapping, welche
// Locales der LanguageSwitcher anzeigt, App-spezifische Strings + i18n-
// Keys. Die Topbar-Komposition (TenantSwitcher + ThemeToggle + UserMenu)
// kommt als `DefaultTopbarActions` aus auth-email-password/web; eigene
// Extras (hier LanguageSwitcher) gehen in den `extras`-Slot.
//
// Schema kommt vom dev-server beim Boot (window.__KUMIKO_SCHEMA__),
// kein hand-geschriebener clientSchema-Mirror mehr.

import {
  DefaultTopbarActions,
  emailPasswordClient,
} from "@kumiko/bundled-features/auth-email-password/web";
import {
  type AppSchema,
  type ClientFeatureDefinition,
  createKumikoApp,
  DefaultAppShell,
  LanguageSwitcher,
} from "@kumiko/renderer-web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";

// Gespiegelt aus server.ts — server.ts darf nicht ins Browser-Bundle
// (importiert framework/runtime). Zwei Zeilen Konstanten sind
// pragmatischer als ein separates shared-Modul.
const DEV_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const BETA_TENANT_ID = "00000000-0000-4000-8000-000000000002";

const tenantName = (tenantId: string): string => {
  if (tenantId === DEV_TENANT_ID) return "Dev Tenant";
  if (tenantId === BETA_TENANT_ID) return "Beta Tenant";
  return tenantId.slice(0, 8);
};

const availableLocales = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
];

// App-level Client-Feature: nur Translations, keine Provider/Gates.
// Pattern ist dasselbe wie bei auth-email-password — der Sample wird
// selbst zu einem "Feature" das seine i18n-Keys mitbringt.
const APP_NAME = "Kumiko Walkthrough";

const appClientFeature: ClientFeatureDefinition = {
  name: "ui-walkthrough",
  translations: {
    de: {
      "tasks.nav.list": "Aufgaben",
      "tasks.nav.new": "Neue Aufgabe",
    },
    en: {
      "tasks.nav.list": "Tasks",
      "tasks.nav.new": "New task",
    },
  },
};

const Brand = (): ReactNode => (
  <strong className="text-foreground tracking-tight">{APP_NAME}</strong>
);

const AppShell = ({
  children,
  schema,
}: {
  readonly children: ReactNode;
  readonly schema: AppSchema;
}): ReactNode => (
  <DefaultAppShell
    brand={<Brand />}
    schema={schema}
    topbarActions={
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

createKumikoApp({
  shell: AppShell,
  clientFeatures: [emailPasswordClient(), appClientFeature],
});
