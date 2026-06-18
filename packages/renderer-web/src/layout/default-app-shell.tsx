// DefaultAppShell — Linear-Pattern: kein globaler Topbar, Sidebar
// nimmt full-height und trägt die ganze Chrome-Identität. 90% der
// Apps brauchen exakt das hier.
//
// Sidebar-Slots:
//   1. brand          — Workspace-Identity oben (z.B. Logo + Name)
//   2. sidebarActions — Icon-Row mit Search/Theme/Tenant-Switch etc.
//   3. NavTree        — automatisch aus dem Schema
//   4. sidebarFooter  — Bottom-Slot für Profile/Help/Plan-Banner
//
// Apps die feingranulare Kontrolle wollen, gehen direkt auf
// <AppLayout>/<Sidebar>/<NavTree>. Wer ein Topbar zurück will (z.B.
// für Multi-Workspace mit Switcher in der Topbar), nutzt
// <WorkspaceShell> oder baut den Shell selber.

import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { AppLayout } from "./app-layout";
import { NavTree } from "./nav-tree";
import { Sidebar } from "./sidebar";

export type DefaultAppShellUser = {
  readonly id: string;
  readonly roles: readonly string[];
};

export type DefaultAppShellProps = {
  /** Header-Slot oben in der Sidebar — Workspace-Identity (Logo,
   *  Name, Plan-Tag). Caller liefert frei. */
  readonly brand: ReactNode;
  /** Schema (AppSchema oder legacy FeatureSchema) wird an NavTree
   *  durchgereicht; Sidebar-Einträge bauen sich automatisch aus
   *  schema.navs (per-Feature) auf. */
  readonly schema: AppSchema | FeatureSchema;
  /** Current user — drives nav role-gating. Ohne user-prop werden
   *  role-gated nav-einträge (`access: { roles: [...] }`) komplett
   *  ausgeblendet (resolveNavigation behandelt undefined-user als
   *  anonymous). Symmetrisch zu WorkspaceShell.user. */
  readonly user?: DefaultAppShellUser;
  /** Icon-Row zwischen Brand und NavTree — typisch Search-Trigger,
   *  ThemeToggle, TenantSwitcher. Linear hat hier ~3 Icons in einer
   *  horizontalen Reihe. */
  readonly sidebarActions?: ReactNode;
  /** Footer-Slot unten in der Sidebar — Profile-Row, Help-Link,
   *  Plan-Banner. Klebt am unteren Rand via `mt-auto`. */
  readonly sidebarFooter?: ReactNode;
  /** Viewport-fit Shell — durchgereicht an AppLayout. true → fixe
   *  Viewport-Höhe, Content scrollt innen statt der ganzen Seite.
   *  Default false (klassischer Seiten-Scroll). Siehe AppLayout.fill. */
  readonly fill?: boolean;
  /** Screen-Content der in `main` gerendert wird. */
  readonly children: ReactNode;
};

export function DefaultAppShell({
  brand,
  schema,
  user,
  sidebarActions,
  sidebarFooter,
  fill,
  children,
}: DefaultAppShellProps): ReactNode {
  return (
    <AppLayout
      fill={fill}
      sidebar={
        <Sidebar header={brand} actions={sidebarActions} footer={sidebarFooter}>
          <NavTree schema={schema} user={user} />
        </Sidebar>
      }
    >
      {children}
    </AppLayout>
  );
}
