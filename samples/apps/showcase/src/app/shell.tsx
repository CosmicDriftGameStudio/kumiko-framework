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

// Zwei Fassungen statt einer: auf Icon-Breite hat ein zweiwortiger Name keinen
// Platz, er bricht um und schiebt sich unter die Rail. Das Kuerzel haelt die
// Kopfzeile auf einer Zeile — dasselbe, was SidebarBrand mit seinem
// Logo-Quadrat tut.
const Brand = (): ReactNode => (
  <>
    <strong className="truncate text-foreground tracking-tight group-data-[collapsible=icon]:hidden">
      Kumiko Showcase
    </strong>
    <strong
      aria-hidden="true"
      className="hidden text-foreground tracking-tight group-data-[collapsible=icon]:inline"
    >
      K
    </strong>
  </>
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
