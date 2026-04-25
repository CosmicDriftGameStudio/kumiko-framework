// DefaultAppShell — komplette Topbar + Sidebar + Main-Layout-Komposition
// die 90% der Apps identisch brauchen. Zieht das aus dem Sample-Copy/
// Paste-Pattern raus. Einzige erwartete App-spezifische Entscheidung
// ist `brand` (Logo/Text links in der Topbar) und `topbarActions`
// (User/Tenant/Theme-Buttons rechts). NavTree wird automatisch aus
// dem Schema aufgebaut.
//
// Apps die feingranulare Kontrolle wollen, gehen weiterhin direkt auf
// <AppLayout>/<Topbar>/<Sidebar>/<NavTree> — dieser Wrapper ist kein
// Muss, nur ein Shortcut.

import type { AppSchema, FeatureSchema } from "@kumiko/renderer";
import type { ReactNode } from "react";
import { AppLayout } from "./app-layout";
import { NavTree } from "./nav-tree";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export type DefaultAppShellProps = {
  /** Content links in der Topbar — Logo, App-Name, Branding. Freier
   *  JSX-Slot, App entscheidet komplett über den Look. */
  readonly brand: ReactNode;
  /** Schema (AppSchema oder legacy FeatureSchema) wird an NavTree
   *  durchgereicht; Sidebar-Einträge bauen sich automatisch aus
   *  schema.navs (per-Feature) auf. */
  readonly schema: AppSchema | FeatureSchema;
  /** Content rechts in der Topbar — typisch LanguageSwitcher,
   *  TenantSwitcher, ThemeToggle, UserMenu. Als ReactNode statt
   *  Array: App ordnet die Reihenfolge selbst. */
  readonly topbarActions?: ReactNode;
  /** Screen-Content der in `main` gerendert wird. Kommt vom
   *  createKumikoApp-Router bzw. vom AuthGate. */
  readonly children: ReactNode;
};

export function DefaultAppShell({
  brand,
  schema,
  topbarActions,
  children,
}: DefaultAppShellProps): ReactNode {
  return (
    <AppLayout
      topbar={<Topbar start={brand} end={topbarActions} />}
      sidebar={
        <Sidebar>
          <NavTree schema={schema} />
        </Sidebar>
      }
    >
      {children}
    </AppLayout>
  );
}
