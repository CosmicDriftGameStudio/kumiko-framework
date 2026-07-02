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

import type { TargetRef, TreeAction, TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import type { NavDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { NavNode, NavRegistrySlice } from "@cosmicdrift/kumiko-headless";
import { resolveNavigation } from "@cosmicdrift/kumiko-headless";
import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  lastSegment,
  toAppSchema,
  useLiveEvents,
  useNav,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import {
  BarChart3,
  Bell,
  Building,
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
  Layers,
  LayoutDashboard,
  LineChart,
  List,
  PiggyBank,
  Plus,
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
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { KumikoLink } from "../app/nav";
import { useNavEntities, useNavProviders } from "../app/nav-providers-context";
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
import { useDispatchTarget } from "./target-resolver-stub";
import { parseTargetFromSearchParams } from "./target-url";

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
  layers: Layers,
  building: Building,
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
  // Runtime-Badges pro Nav-Item, gekeyt auf die BARE nav-id (lastSegment der
  // qualifiedName, also `"tarif"` nicht `"app:nav:tarif"`). Wert ist frei —
  // die App liefert Text UND Farbe (`<Badge className="bg-amber-…">Pro</Badge>`).
  // Für dynamische Zustände (Tier-Badge), die nicht ins statische Schema gehören.
  readonly navBadges?: ReadonlyMap<string, ReactNode>;
};

const EMPTY_BADGES: ReadonlyMap<string, ReactNode> = new Map();
const NavBadgesContext = createContext<ReadonlyMap<string, ReactNode>>(EMPTY_BADGES);

export function NavTree({
  schema,
  user,
  testId,
  allowedNavQns,
  navBadges,
}: NavTreeProps): ReactNode {
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
    <NavBadgesContext.Provider value={navBadges ?? EMPTY_BADGES}>
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
    </NavBadgesContext.Provider>
  );
}

// Runtime-Badge-Slot rechts am Label, gekeyt auf die bare nav-id. Kein
// Eintrag → nichts (silent, kein Layout-Shift). shrink-0 + die ml-auto
// schiebt ihn ans rechte Ende; das truncate-Label gibt nach.
// ponytail: nur an screen/target-Leaves verdrahtet, nicht an Container-
// Knoten (die tragen den ml-auto-Chevron) — Tier-Badge ist ein Leaf.
// Defense-in-depth (555/4): every current call site already guards on
// node.screen/node.target !== undefined before rendering <NavBadge>, so this
// early-return changes no current behavior — it's here so a future call
// site added without that guard can't silently show a leaf's badge on an
// unrelated container node that happens to share its last-segment.
function NavBadge({ node }: { readonly node: NavNode }): ReactNode {
  const badges = useContext(NavBadgesContext);
  if (node.screen === undefined && node.target === undefined) return null;
  const badge = badges.get(lastSegment(node.qualifiedName));
  if (badge === undefined) return null;
  return <span className="ml-auto shrink-0">{badge}</span>;
}

// Pure section = ein Gruppen-Header ohne eigenen Screen, der nur seine
// children gruppiert. Auf Top-Level wird daraus eine SidebarGroup mit
// togglebarem GroupLabel; ein Node mit Screen (auch wenn er children hat)
// ist dagegen ein klickbarer Menu-Eintrag.
function isPureSection(node: NavNode): boolean {
  return (
    node.screen === undefined &&
    node.target === undefined &&
    node.provider !== true &&
    node.createAction === undefined &&
    node.children.length > 0
  );
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

// Stable-reference empty-list — sonst destabilisiert ein neues `[]` pro
// Render die useEffect-deps der SSE-Subscription.
const EMPTY_ENTITY_LIST: readonly string[] = [];

// Active-Target-Vergleich: featureId + action exakt, args shallow-equal
// (heute nur primitives). Gespiegelt aus dem alten TreeNodeRenderer.
function targetsEqual(a: TargetRef, b: TargetRef | undefined): boolean {
  if (b === undefined) return false;
  if (a.featureId !== b.featureId || a.action !== b.action) return false;
  const aKeys = a.args ? Object.keys(a.args) : [];
  const bKeys = b.args ? Object.keys(b.args) : [];
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a.args?.[k] !== b.args?.[k]) return false;
  }
  return true;
}

// Adapter: provider-emittierte TreeNodes → renderbare NavNodes. Synthetische
// QN aus parent-QN + idx-label (stabil über Emit-Order). Statische children
// rekursiv. ponytail: eine TreeChildrenSubscribe-Function als children wird
// als Leaf behandelt — nested-dynamic-Provider nutzt heute kein Consumer;
// upgrade-path = synthetische QN registrieren wenn einer sie emittet.
function treeNodeToNavNode(tn: TreeNode, parentQn: string, idx: number): NavNode {
  const qualifiedName = `${parentQn}/${idx}-${tn.label}`;
  const children = Array.isArray(tn.children)
    ? tn.children.map((c, i) => treeNodeToNavNode(c, qualifiedName, i))
    : [];
  return {
    qualifiedName,
    label: tn.label,
    order: idx,
    children,
    ...(tn.icon !== undefined && { icon: tn.icon }),
    ...(tn.target !== undefined && { target: tn.target }),
    ...(tn.actions !== undefined && { actions: tn.actions }),
    ...(tn.createAction !== undefined && { createAction: tn.createAction }),
  };
}

// Lazy provider-children + SSE-Live-Refresh für einen `provider: true`-Knoten.
// Subscribe läuft erst wenn der Knoten ausgeklappt ist (enabled); die
// treeEntities-Liste (per QN) re-fired den Provider bei Entity-Events → neu
// erstellte Knoten erscheinen live. Logik gespiegelt aus VisualTree.ProviderBranch.
function useNavProviderChildren(
  qn: string,
  enabled: boolean,
): { readonly nodes: readonly NavNode[] | null; readonly error: string | null } {
  const providers = useNavProviders();
  const entitiesMap = useNavEntities();
  const subscribeLive = useLiveEvents();
  const provider = providers.get(qn);
  const entities = entitiesMap.get(qn) ?? EMPTY_ENTITY_LIST;
  const [raw, setRaw] = useState<readonly TreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || entities.length === 0) return;
    const unsubs = entities.map((e) => subscribeLive(e, () => setAttempt((n) => n + 1)));
    return () => {
      for (const u of unsubs) u();
    };
  }, [enabled, entities, subscribeLive]);

  // `attempt` triggert SSE-Refresh + erneutes Subscribe — Biome sieht es
  // nicht im body, semantisch ist es der re-fire-Trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt = re-fire trigger
  useEffect(() => {
    if (!enabled) {
      setRaw(null);
      setError(null);
      return;
    }
    if (provider === undefined) {
      setError("Kein nav-provider registriert.");
      return;
    }
    setError(null);
    setRaw(null);
    try {
      const subscribe = provider();
      try {
        return subscribe(setRaw, (e) => setError(e instanceof Error ? e.message : String(e)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Subscribe fehlgeschlagen.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Provider-Init fehlgeschlagen.");
    }
    return undefined;
  }, [enabled, provider, attempt]);

  const nodes = useMemo(
    () => (raw === null ? null : raw.map((tn, i) => treeNodeToNavNode(tn, qn, i))),
    [raw, qn],
  );
  return { nodes, error };
}

type NavNodeState = {
  readonly displayLabel: string;
  readonly isCollapsed: boolean;
  readonly expandable: boolean;
  readonly isExpanded: boolean;
  readonly active: boolean;
  readonly childNodes: readonly NavNode[];
  readonly providerLoading: boolean;
  readonly providerError: string | null;
  readonly workspaceId: string | undefined;
};

// Geteilte Knoten-Logik für Top-Level- (NavMenuNode) und Sub-Knoten
// (NavSubNode): Label, Expand/Collapse, active-State (screen ODER target),
// und die lazy Provider-Children. Die zwei Renderer unterscheiden sich nur
// in den shadcn-Primitives, nicht in dieser Logik.
function useNavNodeState(node: NavNode, collapsed: ReadonlySet<string>): NavNodeState {
  const nav = useNav();
  const displayLabel = useLabel(node);
  const isCollapsed = collapsed.has(node.qualifiedName);
  const expandable = node.children.length > 0 || node.provider === true;
  const isExpanded = expandable && !isCollapsed;
  const { nodes: providerChildren, error: providerError } = useNavProviderChildren(
    node.qualifiedName,
    node.provider === true && isExpanded,
  );
  const activeTarget = useMemo(
    () => parseTargetFromSearchParams(nav.searchParams),
    [nav.searchParams],
  );
  const screenActive =
    node.screen !== undefined && nav.route?.screenId === lastSegment(node.screen);
  const targetActive = node.target !== undefined && targetsEqual(node.target, activeTarget);
  const childNodes = node.provider === true ? (providerChildren ?? []) : node.children;
  return {
    displayLabel,
    isCollapsed,
    expandable,
    isExpanded,
    active: screenActive || targetActive,
    childNodes,
    providerLoading: node.provider === true && isExpanded && providerChildren === null,
    providerError,
    workspaceId: nav.route?.workspaceId,
  };
}

// Action-Icon-Lookup: bekannter NAV_ICONS-Key → Lucide, sonst der rohe
// String als Text (Provider-Konvention, kein Boot-Fail bei unknown).
function ActionGlyph({ icon }: { readonly icon: string }): ReactNode {
  const Icon = NAV_ICONS[icon];
  if (Icon !== undefined) return <Icon aria-hidden className="size-3.5" />;
  return (
    <span aria-hidden className="text-xs">
      {icon}
    </span>
  );
}

// Hover-Actions + „+"-Affordance, absolut rechts (links vom Chevron via
// right-7). createAction ist persistent (User-sichtbares „+"), übrige
// Actions erst bei Hover. stopPropagation, damit der Row-Click (toggle/
// dispatch) nicht zusätzlich feuert.
function NodeActions({ node }: { node: NavNode }): ReactNode {
  const dispatch = useDispatchTarget();
  const t = useTranslation();
  const create = node.createAction;
  const actions = node.actions ?? [];
  if (create === undefined && actions.length === 0) return null;
  const label = (s: string): string => (s.includes(".") ? t(s) : s);
  const btn =
    "flex size-5 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const hover =
    "opacity-0 group-hover/menu-item:opacity-100 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-item:opacity-100";
  return (
    <div className="absolute top-1 right-7 flex items-center gap-0.5">
      {create !== undefined && (
        <button
          type="button"
          aria-label={label(create.label)}
          className={btn}
          onClick={(e) => {
            e.stopPropagation();
            dispatch(create.target);
          }}
        >
          <Plus className="size-3.5" />
        </button>
      )}
      {actions.map((a: TreeAction) => (
        <button
          key={a.label}
          type="button"
          aria-label={label(a.label)}
          className={cn(btn, hover)}
          onClick={(e) => {
            e.stopPropagation();
            dispatch(a.target);
          }}
        >
          <ActionGlyph icon={a.icon} />
        </button>
      ))}
    </div>
  );
}

// Status-Zeilen innerhalb einer Provider-Sub-Liste (lazy-loading / error).
function ProviderStatus({
  loading,
  error,
}: {
  readonly loading: boolean;
  readonly error: string | null;
}): ReactNode {
  if (error !== null) {
    return <li className="px-2 py-1 text-xs text-destructive">{error}</li>;
  }
  if (loading) {
    return <li className="px-2 py-1 text-xs text-sidebar-foreground/60 italic">Lädt …</li>;
  }
  return null;
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

// Ein Menu-Eintrag (Top-Level-Item oder Section-Child). Drei Klick-Modi am
// EINEN Knoten: `screen` → Route-Link (KumikoLink), `target` → EditorPanel-
// Dispatch (useDispatchTarget), keins → Container/Provider-Knoten der nur
// auf-/zuklappt. Provider-Knoten laden ihre Children lazy + SSE-live. Der
// Collapse-Chevron sitzt als SidebarMenuAction daneben (separater Button,
// sonst <button> im <a> = invalides HTML); createAction/actions als
// absolute NodeActions links davon.
function NavMenuNode({ node, collapsed, onToggle }: NavSubProps): ReactNode {
  const t = useTranslation();
  const dispatch = useDispatchTarget();
  const s = useNavNodeState(node, collapsed);

  const sub = s.isExpanded ? (
    <SidebarMenuSub>
      <ProviderStatus loading={s.providerLoading} error={s.providerError} />
      {s.childNodes.map((child) => (
        <NavSubNode
          key={child.qualifiedName}
          node={child}
          collapsed={collapsed}
          onToggle={onToggle}
        />
      ))}
    </SidebarMenuSub>
  ) : null;

  const chevron = s.expandable ? (
    <SidebarMenuAction
      aria-label={t(s.isCollapsed ? "kumiko.nav.expand" : "kumiko.nav.collapse")}
      aria-expanded={!s.isCollapsed}
      onClick={() => onToggle(node.qualifiedName)}
    >
      {s.isCollapsed ? <ChevronRight /> : <ChevronDown />}
    </SidebarMenuAction>
  ) : null;

  if (node.screen !== undefined) {
    const screenId = lastSegment(node.screen);
    return (
      <SidebarMenuItem>
        {/* tooltip = Label, das shadcn nur im collapsed-Icon-State einblendet. */}
        <SidebarMenuButton asChild isActive={s.active} tooltip={s.displayLabel}>
          <KumikoLink
            to={{ ...(s.workspaceId !== undefined && { workspaceId: s.workspaceId }), screenId }}
            {...(s.active && { "aria-current": "page" })}
          >
            <NavLeadingIcon node={node} active={s.active} />
            <span className="min-w-0 truncate">{s.displayLabel}</span>
            <NavBadge node={node} />
          </KumikoLink>
        </SidebarMenuButton>
        <NodeActions node={node} />
        {chevron}
        {sub}
      </SidebarMenuItem>
    );
  }

  if (node.target !== undefined) {
    const target = node.target;
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={s.active}
          tooltip={s.displayLabel}
          onClick={() => dispatch(target)}
        >
          <NavLeadingIcon node={node} active={s.active} />
          <span className="min-w-0 truncate">{s.displayLabel}</span>
          <NavBadge node={node} />
        </SidebarMenuButton>
        <NodeActions node={node} />
        {chevron}
        {sub}
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={() => {
          if (s.expandable) onToggle(node.qualifiedName);
        }}
        {...(s.expandable && { "aria-expanded": !s.isCollapsed })}
      >
        <NavLeadingIcon node={node} active={false} />
        <span className="truncate">{s.displayLabel}</span>
        {s.expandable &&
          (s.isCollapsed ? (
            <ChevronRight className="ml-auto" />
          ) : (
            <ChevronDown className="ml-auto" />
          ))}
      </SidebarMenuButton>
      <NodeActions node={node} />
      {sub}
    </SidebarMenuItem>
  );
}

// Verschachtelte Einträge (innerhalb SidebarMenuSub). Gleiche drei Klick-Modi
// wie NavMenuNode, nur mit den Sub-Primitives. Folder-/Container-Knoten (kein
// screen/target) klappen auf — Provider-Children + tiefere Statics rekursiv.
// Non-Link-Klickziele brauchen asChild+<button> (SidebarMenuSubButton ist ein
// <a>); der Chevron sitzt als eigener absoluter Button (kein Button-im-<a>).
function NavSubNode({ node, collapsed, onToggle }: NavSubProps): ReactNode {
  const t = useTranslation();
  const dispatch = useDispatchTarget();
  const s = useNavNodeState(node, collapsed);

  const deeper = s.isExpanded ? (
    <>
      <ProviderStatus loading={s.providerLoading} error={s.providerError} />
      {s.childNodes.map((child) => (
        <NavSubNode
          key={child.qualifiedName}
          node={child}
          collapsed={collapsed}
          onToggle={onToggle}
        />
      ))}
    </>
  ) : null;

  const chevron = s.expandable ? (
    <button
      type="button"
      aria-label={t(s.isCollapsed ? "kumiko.nav.expand" : "kumiko.nav.collapse")}
      aria-expanded={!s.isCollapsed}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(node.qualifiedName);
      }}
      className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      {s.isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
    </button>
  ) : null;

  if (node.screen !== undefined) {
    const screenId = lastSegment(node.screen);
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton asChild isActive={s.active}>
          <KumikoLink
            to={{ ...(s.workspaceId !== undefined && { workspaceId: s.workspaceId }), screenId }}
            {...(s.active && { "aria-current": "page" })}
          >
            <NavLeadingIcon node={node} active={s.active} />
            <span className="min-w-0 truncate">{s.displayLabel}</span>
            <NavBadge node={node} />
          </KumikoLink>
        </SidebarMenuSubButton>
        <NodeActions node={node} />
        {chevron}
        {deeper}
      </SidebarMenuSubItem>
    );
  }

  if (node.target !== undefined) {
    const target = node.target;
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton asChild isActive={s.active}>
          <button type="button" onClick={() => dispatch(target)}>
            <NavLeadingIcon node={node} active={s.active} />
            <span className="min-w-0 truncate">{s.displayLabel}</span>
            <NavBadge node={node} />
          </button>
        </SidebarMenuSubButton>
        <NodeActions node={node} />
        {chevron}
        {deeper}
      </SidebarMenuSubItem>
    );
  }

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild>
        <button
          type="button"
          onClick={() => {
            if (s.expandable) onToggle(node.qualifiedName);
          }}
        >
          <NavLeadingIcon node={node} active={false} />
          <span className="truncate">{s.displayLabel}</span>
        </button>
      </SidebarMenuSubButton>
      <NodeActions node={node} />
      {chevron}
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
