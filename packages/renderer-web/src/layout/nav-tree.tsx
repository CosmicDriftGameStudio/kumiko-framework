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
    <div data-testid={testId} data-kumiko-layout="nav-tree" className="flex flex-col gap-0.5">
      {tree.map((node) => (
        <NavNodeItem
          key={node.qualifiedName}
          node={node}
          depth={0}
          collapsed={collapsed}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

type NavNodeItemProps = {
  readonly node: NavNode;
  readonly depth: number;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (qn: string) => void;
};

function NavNodeItem({ node, depth, collapsed, onToggle }: NavNodeItemProps): ReactNode {
  const nav = useNav();
  const t = useTranslation();
  const active = node.screen !== undefined && nav.route?.screenId === lastSegment(node.screen);

  const NavIcon = node.icon !== undefined ? NAV_ICONS[node.icon] : undefined;
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.qualifiedName);
  const indent = { paddingLeft: `${0.5 + depth * 1}rem` };

  // i18n-Key Konvention: wenn label einen Punkt enthält, durchs t()
  // laufen lassen — wenn Bundle den Key kennt, wird übersetzt, sonst
  // bleibt der key selbst stehen (und der App-Dev sieht dass er eine
  // Übersetzung vergessen hat). Reine String-Labels ("Dashboard")
  // bleiben unangetastet durch das Mapping.
  const displayLabel = node.label.includes(".") ? t(node.label) : node.label;

  // In workspace mode the URL is /<ws>/<screen> — sidebar links must
  // carry the active workspaceId, otherwise navigate({ screenId }) would
  // produce /<screen> and the parser would interpret <screen> as a
  // workspace id. Pulled from useNav().route so the link tracks switches.
  const workspaceId = nav.route?.workspaceId;

  // Chevron-Icon — nur wenn Node children hat. Rechts neben dem Label
  // angeordnet; ein Click auf den Chevron alleine toggled die Section
  // ohne zu navigieren (stopPropagation auf dem KumikoLink-Wrapper).
  const chevron = hasChildren ? (
    <button
      type="button"
      aria-label={t(isCollapsed ? "kumiko.nav.expand" : "kumiko.nav.collapse")}
      aria-expanded={!isCollapsed}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(node.qualifiedName);
      }}
      className="ml-auto flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
    </button>
  ) : null;

  const children =
    hasChildren && !isCollapsed
      ? node.children.map((child) => (
          <NavNodeItem
            key={child.qualifiedName}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))
      : null;

  // Variante 1: Node hat einen Screen → KumikoLink. Wenn das Item auch
  // children hat, sitzt der Chevron als Geschwister rechts NEBEN dem
  // Link (nicht IM Link) — sonst würde ein <button> im <a> für invalid
  // HTML sorgen. Wrapper-Div bekommt das hover/active-Styling, Link
  // selbst ist nur die Klick-Fläche.
  if (node.screen !== undefined) {
    const screenId = lastSegment(node.screen);
    const rowClass = cn(
      "flex h-7 items-center gap-2 rounded-md text-[13px] transition-colors",
      "hover:bg-accent/60 hover:text-foreground",
      active
        ? "bg-accent text-foreground font-medium"
        : "text-muted-foreground hover:text-foreground",
    );
    return (
      <>
        <div style={indent} className={rowClass}>
          <KumikoLink
            to={{ ...(workspaceId !== undefined && { workspaceId }), screenId }}
            className={cn(
              "flex flex-1 min-w-0 items-center gap-2 px-2 h-full",
              hasChildren && "pr-0",
            )}
            {...(active && { "aria-current": "page" })}
          >
            {NavIcon !== undefined ? (
              <NavIcon
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              />
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block size-1.5 rounded-full",
                  active ? "bg-accent-foreground" : "bg-muted-foreground/40",
                )}
              />
            )}
            <span className="truncate">{displayLabel}</span>
          </KumikoLink>
          {chevron !== null && <div className="pr-2">{chevron}</div>}
        </div>
        {children}
      </>
    );
  }

  // Variante 2: Node ist ein Section-Header (kein Screen). Mit children
  // wird das Label zum Toggle-Button — Click klappt die ganze Section
  // auf/zu. Chevron rendert hier als Span (kein nested button), weil
  // der äußere Button schon das Toggle-Target ist. Ohne children
  // rendert ein dezenter Section-Header (uppercase).
  const chevronSpan = hasChildren ? (
    <span aria-hidden="true" className="ml-auto flex size-4 items-center justify-center">
      {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
    </span>
  ) : null;
  return (
    <>
      {hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(node.qualifiedName)}
          aria-expanded={!isCollapsed}
          style={indent}
          className="flex h-7 items-center gap-2 rounded-md px-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground transition-colors text-left"
        >
          <span className="truncate">{displayLabel}</span>
          {chevronSpan}
        </button>
      ) : (
        <div
          style={indent}
          className="px-2 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70"
        >
          {displayLabel}
        </div>
      )}
      {children}
    </>
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
