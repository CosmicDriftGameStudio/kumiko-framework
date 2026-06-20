// NavTree: Sidebar-Navigation aus dem Schema. Multi-Feature-aware —
// jedes Feature trägt seinen Featurenamen, der zum Qualifizieren der
// nav-ids genutzt wird. Pre-qualifizierte ids (enthält schon ":nav:")
// gehen unverändert durch — so können einzelne Features Cross-Feature-
// Referenzen einfügen ohne zur AppSchema migrieren zu müssen.
//
// Aktiver Eintrag bekommt die accent-Farben (hintergrund + foreground),
// inaktive nur muted-foreground. Rekursiv mit Indentation pro Tiefe.
//
// Parent-Nodes mit children sind collapsible — Chevron rechts toggled
// auf/zu. State lebt lokal im NavTree (useState); Default expanded
// für alles, Caller kann später localStorage-Persistenz drüberlegen.

import type { NavDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { NavNode, NavRegistrySlice } from "@cosmicdrift/kumiko-headless";
import { resolveNavigation } from "@cosmicdrift/kumiko-headless";
import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { lastSegment, toAppSchema, useNav, useTranslation } from "@cosmicdrift/kumiko-renderer";
import {
  BarChart3,
  Bell,
  Calculator,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Coins,
  CreditCard,
  FileText,
  Folder,
  Gauge,
  Home,
  LayoutDashboard,
  LineChart,
  List,
  PiggyBank,
  Receipt,
  Search,
  Settings,
  Shield,
  Sparkles,
  Table,
  TrendingUp,
  User,
  Users,
  Wallet,
  Wand2,
} from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { KumikoLink } from "../app/nav";
import { cn } from "../lib/cn";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../ui/sidebar";

// Nav-Icon-Registry: ein Nav-Eintrag setzt `icon: "<key>"` (im r.nav-Decl),
// der Renderer mappt den symbolischen Key auf ein lucide-Component. Unknown
// Keys → kein Icon (sauberer Fallback auf den Dot, kein Boot-Fail). Spiegelt
// das NODE_ICONS-Muster vom Visual-Tree. App-Authors referenzieren nur diese
// Keys; Erweiterung = neuer Eintrag hier (eine Quelle, alle Apps).
const NAV_ICONS: Readonly<Record<string, typeof Folder>> = {
  dashboard: LayoutDashboard,
  gauge: Gauge,
  list: List,
  table: Table,
  calculator: Calculator,
  wallet: Wallet,
  coins: Coins,
  "credit-card": CreditCard,
  "piggy-bank": PiggyBank,
  receipt: Receipt,
  chart: LineChart,
  "bar-chart": BarChart3,
  trending: TrendingUp,
  sparkles: Sparkles,
  wand: Wand2,
  calendar: CalendarDays,
  file: FileText,
  folder: Folder,
  home: Home,
  bell: Bell,
  shield: Shield,
  settings: Settings,
  users: Users,
  user: User,
  search: Search,
};

export type NavTreeProps = {
  // Akzeptiert beide Shapes — AppSchema (multi-feature) oder
  // FeatureSchema (legacy single-feature). toAppSchema normalisiert
  // intern, sodass die Pipeline nur AppSchema kennt.
  readonly schema: AppSchema | FeatureSchema;
  readonly user?: { readonly id: string; readonly roles: readonly string[] };
  readonly testId?: string;
  // Workspace membership filter — when set, only nav entries whose qualified
  // id is in the set are visible. WorkspaceShell passes the active
  // workspace's `navMembers` list. Undefined = no filter (legacy / non-
  // workspace apps render every nav).
  readonly allowedNavQns?: ReadonlySet<string>;
};

export function NavTree({ schema, user, testId, allowedNavQns }: NavTreeProps): ReactNode {
  const app = useMemo(() => toAppSchema(schema), [schema]);
  const tree = useMemo(() => {
    const source = buildNavRegistrySliceForApp(app, allowedNavQns);
    return resolveNavigation({ source, ...(user !== undefined && { user }) });
  }, [app, user, allowedNavQns]);

  // Collapsed-Set: nur die explizit zugeklappten qualified-names. Default
  // ist also "alles auf" — neue Features tauchen sofort offen auf, ohne
  // dass der User erst klicken muss.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = useCallback((qn: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(qn)) next.delete(qn);
      else next.add(qn);
      return next;
    });
  }, []);

  return (
    <div data-testid={testId} data-kumiko-layout="nav-tree" className="flex w-full flex-col">
      {tree.map((node) =>
        isPureSection(node) ? (
          <NavSection
            key={node.qualifiedName}
            node={node}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ) : (
          <SidebarMenu key={node.qualifiedName} className="px-2 py-1">
            <NavMenuNode node={node} collapsed={collapsed} onToggle={onToggle} />
          </SidebarMenu>
        ),
      )}
    </div>
  );
}

// Pure section = ein Gruppen-Header ohne eigenen Screen, der nur seine
// children gruppiert. Auf Top-Level wird daraus eine SidebarGroup mit
// togglebarem GroupLabel; ein Node mit Screen (auch wenn er children hat)
// ist dagegen ein klickbarer Menu-Eintrag.
function isPureSection(node: NavNode): boolean {
  return node.screen === undefined && node.children.length > 0;
}

type NavSubProps = {
  readonly node: NavNode;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (qn: string) => void;
};

// i18n-Key Konvention: enthält das label einen Punkt, durchs t() laufen
// lassen (Bundle kennt den Key → übersetzt, sonst bleibt der Key sichtbar
// = vergessene Übersetzung). Reine String-Labels bleiben unangetastet.
function useLabel(node: NavNode): string {
  const t = useTranslation();
  return node.label.includes(".") ? t(node.label) : node.label;
}

// Icon-or-Dot: bekannter icon-Key → Lucide-Icon, sonst ein dezenter Dot.
// Aktiv = accent-foreground, inaktiv = gedimmt.
function NavLeadingIcon({ node, active }: { node: NavNode; active: boolean }): ReactNode {
  const NavIcon = node.icon !== undefined ? NAV_ICONS[node.icon] : undefined;
  if (NavIcon !== undefined) return <NavIcon aria-hidden="true" className="shrink-0" />;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 rounded-full",
        active ? "bg-sidebar-accent-foreground" : "bg-sidebar-foreground/40",
      )}
    />
  );
}

// Top-Level-Section: SidebarGroup mit STATISCHEM Label (sidebar-07-Muster —
// "Platform"/"Projects" sind feste Überschriften, keine Toggles). Collapse
// gehört auf Items MIT children, nicht auf die Section selbst.
function NavSection({ node, collapsed, onToggle }: NavSubProps): ReactNode {
  const displayLabel = useLabel(node);
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel>{displayLabel}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {node.children.map((child) => (
            <NavMenuNode
              key={child.qualifiedName}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// Ein Menu-Eintrag (Top-Level-Item oder Section-Child). Hat er einen Screen,
// rendert ein SidebarMenuButton-Link; hat er zusätzlich children, sitzt der
// Collapse-Chevron als SidebarMenuAction daneben (separater Button, sonst
// <button> im <a> = invalides HTML). Ohne Screen aber mit children ist es
// eine verschachtelte Section als klickbare Zeile.
function NavMenuNode({ node, collapsed, onToggle }: NavSubProps): ReactNode {
  const nav = useNav();
  const t = useTranslation();
  const active = node.screen !== undefined && nav.route?.screenId === lastSegment(node.screen);
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.qualifiedName);
  const displayLabel = useLabel(node);
  const workspaceId = nav.route?.workspaceId;

  const sub =
    hasChildren && !isCollapsed ? (
      <SidebarMenuSub>
        {node.children.map((child) => (
          <NavSubNode
            key={child.qualifiedName}
            node={child}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))}
      </SidebarMenuSub>
    ) : null;

  if (node.screen === undefined) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => onToggle(node.qualifiedName)}
          aria-expanded={!isCollapsed}
        >
          <NavLeadingIcon node={node} active={false} />
          <span className="truncate">{displayLabel}</span>
          {hasChildren &&
            (isCollapsed ? (
              <ChevronRight className="ml-auto" />
            ) : (
              <ChevronDown className="ml-auto" />
            ))}
        </SidebarMenuButton>
        {sub}
      </SidebarMenuItem>
    );
  }

  const screenId = lastSegment(node.screen);
  return (
    <SidebarMenuItem>
      {/* tooltip = Label, das shadcn nur im collapsed-Icon-State einblendet. */}
      <SidebarMenuButton asChild isActive={active} tooltip={displayLabel}>
        <KumikoLink
          to={{ ...(workspaceId !== undefined && { workspaceId }), screenId }}
          {...(active && { "aria-current": "page" })}
        >
          <NavLeadingIcon node={node} active={active} />
          <span className="truncate">{displayLabel}</span>
        </KumikoLink>
      </SidebarMenuButton>
      {hasChildren && (
        <SidebarMenuAction
          aria-label={t(isCollapsed ? "kumiko.nav.expand" : "kumiko.nav.collapse")}
          aria-expanded={!isCollapsed}
          onClick={() => onToggle(node.qualifiedName)}
        >
          {isCollapsed ? <ChevronRight /> : <ChevronDown />}
        </SidebarMenuAction>
      )}
      {sub}
    </SidebarMenuItem>
  );
}

// Verschachtelte Einträge (innerhalb SidebarMenuSub). Leaves rendern als
// SidebarMenuSubButton-Link; tiefer verschachtelte Sections degradieren auf
// eine flache rekursive Liste (2 Ebenen sind die Norm).
function NavSubNode({ node, collapsed, onToggle }: NavSubProps): ReactNode {
  const nav = useNav();
  const active = node.screen !== undefined && nav.route?.screenId === lastSegment(node.screen);
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.qualifiedName);
  const displayLabel = useLabel(node);
  const workspaceId = nav.route?.workspaceId;

  const deeper =
    hasChildren && !isCollapsed
      ? node.children.map((child) => (
          <NavSubNode
            key={child.qualifiedName}
            node={child}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))
      : null;

  if (node.screen === undefined) {
    return (
      <SidebarMenuSubItem>
        <button
          type="button"
          onClick={() => onToggle(node.qualifiedName)}
          aria-expanded={!isCollapsed}
          className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium uppercase tracking-wider text-sidebar-foreground/70"
        >
          <span className="truncate">{displayLabel}</span>
        </button>
        {deeper}
      </SidebarMenuSubItem>
    );
  }

  const screenId = lastSegment(node.screen);
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={active}>
        <KumikoLink
          to={{ ...(workspaceId !== undefined && { workspaceId }), screenId }}
          {...(active && { "aria-current": "page" })}
        >
          <span className="truncate">{displayLabel}</span>
        </KumikoLink>
      </SidebarMenuSubButton>
      {deeper}
    </SidebarMenuSubItem>
  );
}

// Backwards-kompatibler Single-Feature-Builder. Convenience-Wrapper um
// buildNavRegistrySliceForApp — bestehende Tests die direkt mit
// FeatureSchema rufen brauchen keine Änderung.
export function buildNavRegistrySlice(
  schema: FeatureSchema,
  allowedNavQns?: ReadonlySet<string>,
): NavRegistrySlice {
  return buildNavRegistrySliceForApp(toAppSchema(schema), allowedNavQns);
}

// Multi-Feature-Variante. Iteriert alle Features, qualifiziert pro
// Feature mit dem eigenen featureName. Reihenfolge: Features in der
// AppSchema-Ordnung, navs in der vom Feature deklarierten Reihenfolge.
//
// Cross-Feature-Workspaces sind hier nativ unterstützt — `navMembers`
// referenzieren QNs, der Filter trifft die jeweils richtigen Einträge
// egal in welchem Feature sie deklariert sind.
export function buildNavRegistrySliceForApp(
  app: AppSchema,
  allowedNavQns?: ReadonlySet<string>,
): NavRegistrySlice {
  const qualified: NavDefinition[] = [];
  for (const feature of app.features) {
    for (const n of feature.navs ?? []) {
      qualified.push({
        ...n,
        id: qualifyNavId(feature.featureName, n.id),
        ...(n.parent !== undefined && { parent: qualifyNavId(feature.featureName, n.parent) }),
        ...(n.screen !== undefined && { screen: qualifyScreenId(feature.featureName, n.screen) }),
      });
    }
  }
  // Workspace filter: drop nav entries whose qualified id isn't in the
  // allow-set. A child whose parent gets dropped surfaces as a top-level
  // entry — the workspace owner should list parents explicitly if they
  // want the grouping preserved.
  const filtered =
    allowedNavQns !== undefined ? qualified.filter((n) => allowedNavQns.has(n.id)) : qualified;
  const allowedQnSet = new Set(filtered.map((n) => n.id));
  const topLevel: NavDefinition[] = [];
  const byParentMap = new Map<string, NavDefinition[]>();
  for (const nav of filtered) {
    // Treat the entry as top-level when its parent isn't visible — keeps
    // children visible after filtering, even if the workspace omits the
    // parent group from its members list.
    const hasVisibleParent = nav.parent !== undefined && allowedQnSet.has(nav.parent);
    if (hasVisibleParent && nav.parent !== undefined) {
      const list = byParentMap.get(nav.parent) ?? [];
      list.push(nav);
      byParentMap.set(nav.parent, list);
    } else {
      topLevel.push(nav);
    }
  }
  return {
    topLevel,
    byParent: (parent) => byParentMap.get(parent) ?? [],
  };
}

function qualifyNavId(feature: string, id: string): string {
  return id.includes(":nav:") ? id : `${feature}:nav:${id}`;
}

function qualifyScreenId(feature: string, id: string): string {
  return id.includes(":screen:") ? id : `${feature}:screen:${id}`;
}

// `lastSegment` lebt jetzt in @cosmicdrift/kumiko-renderer (./app/qn) — eine
// Quelle, beide Pakete teilen sie.
export { lastSegment };
