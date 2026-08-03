// AppShell — wrappt DefaultAppShell mit Brand + Sidebar-Actions. Custom-
// Screen-Routing macht das Framework jetzt automatisch (clientFeatures.
// components → CustomScreensProvider → KumikoScreen-Lookup), entsprechend
// keine eigene DEMO_PAGES-Map mehr im Shell.

import {
  type AppSchema,
  DefaultAppShell,
  ProfileMenu,
  type ProfileMenuItem,
  ThemeToggle,
} from "@cosmicdrift/kumiko-renderer-web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";

// Logo-Kachel + Wortmarke — wie SidebarBrand (sidebar-brand.tsx). Die
// Kachel bleibt collapsed stehen (liest sich als Logo, nicht als
// zufaelliger Buchstabe), nur die Wortmarke daneben blendet aus.
const Brand = (): ReactNode => (
  <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
    <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
      <span className="text-sm font-semibold">K</span>
    </div>
    <strong className="truncate text-foreground tracking-tight group-data-[collapsible=icon]:hidden">
      Kumiko Showcase
    </strong>
  </div>
);

// Linear-Style Profile-Menu Demo. items sind App-spezifisch — Caller
// definiert was clickbar ist + ggf. Keyboard-Shortcuts. Hier ein
// realistischer set mit View-Profile, Settings, Sign-out.
const PROFILE_USER = { id: "showcase-admin-1", label: "Showcase Admin" } as const;
const PROFILE_ITEMS: ReadonlyArray<ProfileMenuItem> = [
  {
    kind: "item",
    id: "view-profile",
    label: "View profile",
    shortcut: "O then M",
    onSelect: () => {
      // biome-ignore lint/suspicious/noConsole: showcase demo
      console.log("[showcase] view profile");
    },
  },
  {
    kind: "item",
    id: "settings",
    label: "Settings",
    shortcut: "G then S",
    onSelect: () => {
      // biome-ignore lint/suspicious/noConsole: showcase demo
      console.log("[showcase] settings");
    },
  },
  { kind: "separator" },
  {
    kind: "item",
    id: "help",
    label: "Help",
    onSelect: () => {
      // biome-ignore lint/suspicious/noConsole: showcase demo
      console.log("[showcase] help");
    },
  },
  {
    kind: "item",
    id: "changelog",
    label: "Changelog",
    onSelect: () => {
      // biome-ignore lint/suspicious/noConsole: showcase demo
      console.log("[showcase] changelog");
    },
  },
  { kind: "separator" },
  {
    kind: "item",
    id: "sign-out",
    label: "Sign out",
    shortcut: "Alt + Q",
    variant: "danger",
    onSelect: () => {
      // biome-ignore lint/suspicious/noConsole: showcase demo
      console.log("[showcase] sign out");
    },
  },
];

const SidebarActions = (): ReactNode => (
  <>
    <ThemeToggle
      lightIcon={<Sun className="h-4 w-4" />}
      darkIcon={<MoonStar className="h-4 w-4" />}
    />
    <ProfileMenu user={PROFILE_USER} items={PROFILE_ITEMS} />
  </>
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
