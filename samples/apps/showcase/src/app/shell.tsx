// AppShell — wrappt DefaultAppShell mit Brand + Sidebar-Actions. Custom-
// Screen-Routing macht das Framework jetzt automatisch (clientFeatures.
// components → CustomScreensProvider → KumikoScreen-Lookup), entsprechend
// keine eigene DEMO_PAGES-Map mehr im Shell.

import { type AppSchema, DefaultAppShell, ThemeToggle } from "@kumiko/renderer-web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";

const Brand = (): ReactNode => (
  <strong className="text-foreground tracking-tight">Kumiko Showcase</strong>
);

const SidebarActions = (): ReactNode => (
  <ThemeToggle
    lightIcon={<Sun className="h-4 w-4" />}
    darkIcon={<MoonStar className="h-4 w-4" />}
  />
);

export function AppShell({
  children,
  schema,
}: {
  readonly children: ReactNode;
  readonly schema: AppSchema;
}): ReactNode {
  return (
    <DefaultAppShell brand={<Brand />} schema={schema} sidebarActions={<SidebarActions />}>
      {children}
    </DefaultAppShell>
  );
}
