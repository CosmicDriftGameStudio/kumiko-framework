// Browser-Entrypoint. Bundled via Bun.build (server.ts).
//
// Was in diesem File steckt ist was eine echte App in dieser Zeile
// auch entscheiden würde: Tenant-Name-Mapping, welche Locales der
// LanguageSwitcher anzeigt, App-spezifische Strings. Die Topbar-
// Komposition selbst (Layout + Sidebar + NavTree) liegt als
// `DefaultAppShell` im Framework.

import {
  emailPasswordClient,
  TenantSwitcher,
  UserMenu,
} from "@kumiko/bundled-features/auth-email-password/web";
import {
  type ClientFeatureDefinition,
  createKumikoApp,
  DefaultAppShell,
  LanguageSwitcher,
  ThemeToggle,
} from "@kumiko/renderer-web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { clientSchema } from "./feature-schema";

// Gespiegelt aus seed.ts — seed.ts darf nicht ins Browser-Bundle
// (importiert argon2 + @kumiko/framework/testing). Zwei Zeilen
// Konstanten sind pragmatischer als ein separates shared-Modul.
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
// selbst zu einem "Feature" das seine i18n-Keys mitbringt. Apps mit
// mehreren Domänen würden das pro Domäne aufteilen oder ein
// zentrales app-translations-Modul laden.
// Brand-Strings sind typischerweise app-konstant — nicht jede Sprache
// braucht einen anderen Markennamen. Daher direkt als string-Literal,
// ohne Umweg über useTranslation. Die i18n-Keys hier (tasks.nav.*)
// gehen über NavTree's useTranslation-Pfad.
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

const TopbarActions = (): ReactNode => (
  <div className="flex items-center gap-2">
    <TenantSwitcher tenantName={tenantName} />
    <LanguageSwitcher locales={availableLocales} />
    <ThemeToggle
      lightIcon={<Sun className="h-4 w-4" />}
      darkIcon={<MoonStar className="h-4 w-4" />}
    />
    <UserMenu />
  </div>
);

const AppShell = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <DefaultAppShell brand={<Brand />} schema={clientSchema} topbarActions={<TopbarActions />}>
    {children}
  </DefaultAppShell>
);

createKumikoApp({
  schema: clientSchema,
  shell: AppShell,
  clientFeatures: [emailPasswordClient(), appClientFeature],
});
