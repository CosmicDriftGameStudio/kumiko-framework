// NavTree: sidebar navigation from the schema. Multi-feature aware —
// each feature contributes its name, which qualifies nav IDs. Pre-qualified
// IDs (already containing ":nav:") pass through unchanged, allowing features
// to add cross-feature references without migrating to AppSchema.
//
// The active entry uses the accent background and foreground colors; inactive
// entries use only muted foreground. Indentation reflects the tree depth.
//
// Parent nodes with children are collapsible; the right chevron toggles them.
// State is local to NavTree (useState) and everything is expanded by default;
// a caller can layer localStorage persistence on top later.

import type {
  AccessRule,
  TargetRef,
  TreeAction,
  TreeNode,
} from "@cosmicdrift/kumiko-framework/engine";
import type { NavDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { ChevronDown, ChevronRight, type Folder, Plus, Search } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { rendererWarn } from "../../dev-console.ts";
import type { NavNode, NavRegistrySlice } from "../../headless/index.ts";
import { resolveNavigation } from "../../headless/index.ts";
import { createLiveRefetchScheduler } from "../../hooks/live-refetch-scheduler.ts";
import type { AppSchema, FeatureSchema } from "../../index.ts";
import { lastSegment, toAppSchema, useLiveEvents, useNav, useTranslation } from "../../index.ts";
import { toggleSetMember } from "../../toggle-set-member.ts";
import { KumikoLink } from "../app/nav.tsx";
import { useNavEntities, useNavProviders } from "../app/nav-providers-context.tsx";
import { NAV_ICONS } from "../icons.tsx";
import { cn } from "../lib/cn.ts";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../ui/sidebar.tsx";
import { resolveParentScreenId } from "./shell-breadcrumb.ts";
import { useDispatchTarget } from "./target-resolver-stub.tsx";
import { parseTargetFromSearchParams } from "./target-url.ts";

// Widened alias for the two lookup sites below, which index by the plain
// `string` icon key of the resolved NavNode/TreeAction tree — not the
// closed NavIconKey union NAV_ICONS itself is typed against.
const NAV_ICON_LOOKUP: Readonly<Record<string, typeof Folder | undefined>> = NAV_ICONS;

export type NavTreeProps = {
  // Accepts both shapes: AppSchema (multi-feature) and FeatureSchema (legacy
  // single-feature). toAppSchema normalizes them internally so the pipeline only
  // handles AppSchema.
  readonly schema: AppSchema | FeatureSchema;
  readonly user?: { readonly id: string; readonly roles: readonly string[] };
  readonly testId?: string;
  // Workspace membership filter — when set, only nav entries whose qualified
  // id is in the set are visible. WorkspaceShell passes the active
  // workspace's `navMembers` list. Undefined = no filter (legacy / non-
  // workspace apps render every nav).
  readonly allowedNavQns?: ReadonlySet<string>;
  // Runtime badges are keyed by the bare nav ID (the lastSegment of the
  // qualifiedName, such as `"tarif"` rather than `"app:nav:tarif"`). The value
  // is unrestricted: the app supplies both the text and color
  // (`<Badge className="bg-amber-…">Pro</Badge>`). This supports dynamic states
  // such as tier badges that do not belong in the static schema.
  readonly navBadges?: ReadonlyMap<string, ReactNode>;
};

const EMPTY_BADGES: ReadonlyMap<string, ReactNode> = new Map();
const NavBadgesContext = createContext<ReadonlyMap<string, ReactNode>>(EMPTY_BADGES);

// The filter is inactive when `q` is empty (`matches` accepts everything).
// `matches` receives the raw label (i18n key or literal text) and translates it
// internally, so the search field filters visible text rather than the key.
type NavFilter = { readonly q: string; readonly matches: (rawLabel: string) => boolean };
const NavFilterContext = createContext<NavFilter>({ q: "", matches: () => true });

// Which nav node should highlight for the current route. `exact` means the
// active screen has its own node in {tree} (aria-current="page" belongs
// here); otherwise {screenId} is the resolved parent from
// resolveParentScreenId — a screen reachable only through a list stays
// orientable, but a Screen-Reader shouldn't be told it IS that list.
type ActiveScreenMarker = { readonly screenId: string; readonly exact: boolean } | undefined;
const ActiveScreenMarkerContext = createContext<ActiveScreenMarker>(undefined);

// Walks only the static `children` — provider-emitted nodes (treeNodeToNavNode
// below) never set `screen`, so they can't hide a match this walk would miss.
export function treeContainsScreen(nodes: readonly NavNode[], screenId: string): boolean {
  return nodes.some(
    (n) =>
      (n.screen !== undefined && lastSegment(n.screen) === screenId) ||
      treeContainsScreen(n.children, screenId),
  );
}

// A node survives filtering when it or a descendant matches.
// Provider children are already materialized during filtering (provider nodes
// are default-expanded → eagerly loaded), so static children recursion is
// sufficient. ponytail: a provider that is still NOT loaded during filtering
// (because the user collapsed it) is expanded via the force-expand in
// useNavNodeState, then loaded and filtered.
function subtreeMatches(node: NavNode, matches: (rawLabel: string) => boolean): boolean {
  return matches(node.label) || node.children.some((c) => subtreeMatches(c, matches));
}

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

  const nav = useNav();
  const activeScreenId = nav.route?.screenId;
  const activeEntityId = nav.route?.entityId;
  // Same "no nav entry of its own" gap the breadcrumb closes:
  // when the routed screen has no node in {tree}, fall back to its
  // resolved parent so a detail/edit/form screen still orients the user.
  const activeMarker = useMemo((): ActiveScreenMarker => {
    if (activeScreenId === undefined) return undefined;
    const allScreens = app.features.flatMap((f) => f.screens);
    const parentScreenId = resolveParentScreenId(allScreens, activeScreenId);
    // A nav entry on an edit screen means "create"; an existing record (entityId
    // in the route) belongs to its list, same rule as the breadcrumb.
    if (
      activeEntityId !== undefined &&
      parentScreenId !== undefined &&
      treeContainsScreen(tree, parentScreenId)
    ) {
      return { screenId: parentScreenId, exact: false };
    }
    if (treeContainsScreen(tree, activeScreenId)) return { screenId: activeScreenId, exact: true };
    return parentScreenId !== undefined ? { screenId: parentScreenId, exact: false } : undefined;
  }, [tree, app.features, activeScreenId, activeEntityId]);

  // The collapsed set contains only explicitly collapsed qualified names.
  // Everything is therefore expanded by default, so new features appear open
  // without requiring the user to click first.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = useCallback((qn: string) => {
    setCollapsed((prev) => toggleSetMember(prev, qn));
  }, []);

  const t = useTranslation();
  const { state: sidebarState } = useSidebar();
  const [filter, setFilter] = useState("");
  // The search box is only CSS-hidden (`group-data-[collapsible=icon]:hidden`)
  // when the sidebar collapses to icon rail, not unmounted — without this,
  // a stale filter re-applies invisibly on the next expand.
  useEffect(() => {
    if (sidebarState === "collapsed") setFilter("");
  }, [sidebarState]);
  const q = filter.trim().toLowerCase();
  const matches = useCallback(
    (raw: string): boolean => {
      const label = raw.includes(".") ? t(raw) : raw;
      return label.toLowerCase().includes(q);
    },
    [t, q],
  );
  const navFilter = useMemo<NavFilter>(() => ({ q, matches }), [q, matches]);

  return (
    <ActiveScreenMarkerContext.Provider value={activeMarker}>
      <NavFilterContext.Provider value={navFilter}>
        <NavBadgesContext.Provider value={navBadges ?? EMPTY_BADGES}>
          <div
            data-testid={testId}
            data-kumiko-layout="nav-tree"
            className="flex w-full flex-col gap-3"
          >
            <div className="relative mb-0 group-data-[collapsible=icon]:hidden">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-sidebar-muted"
              />
              <SidebarInput
                className="pl-8"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("kumiko.nav.search")}
                aria-label={t("kumiko.nav.search")}
              />
            </div>
            {groupTopLevelRuns(tree).map((run) =>
              run.kind === "section" ? (
                <NavSection
                  key={run.node.qualifiedName}
                  node={run.node}
                  collapsed={collapsed}
                  onToggle={onToggle}
                />
              ) : (
                <SidebarMenu key={run.nodes[0].qualifiedName} className="empty:hidden">
                  {run.nodes.map((node) => (
                    <NavMenuNode
                      key={node.qualifiedName}
                      node={node}
                      collapsed={collapsed}
                      onToggle={onToggle}
                    />
                  ))}
                </SidebarMenu>
              ),
            )}
          </div>
        </NavBadgesContext.Provider>
      </NavFilterContext.Provider>
    </ActiveScreenMarkerContext.Provider>
  );
}

// The runtime badge slot is keyed by the bare nav ID. With no entry it
// renders nothing, avoiding layout shift. shrink-0 and ml-auto move it to the
// right edge while the truncated label gives up space.
// ponytail: badges are wired only to screen/target leaves, not container nodes
// (which use the ml-auto chevron). A tier badge belongs on a leaf.
// Defense-in-depth: current call sites already guard on
// node.screen/node.target !== undefined before rendering <NavBadge>, so this
// early return does not change current behavior. It prevents a future call
// site without that guard from showing a leaf badge on an unrelated container
// node that happens to share its last segment.
function NavBadge({ node }: { readonly node: NavNode }): ReactNode {
  const badges = useContext(NavBadgesContext);
  if (node.screen === undefined && node.target === undefined) return null;
  const badge = badges.get(lastSegment(node.qualifiedName));
  if (badge === undefined) return null;
  return <span className="ml-auto shrink-0">{badge}</span>;
}

// A pure section is a group header without its own screen that only groups
// its children. At the top level it becomes a SidebarGroup with a toggleable
// GroupLabel; a node with a screen remains a clickable menu entry even when it
// also has children.
function isPureSection(node: NavNode): boolean {
  return (
    node.screen === undefined &&
    node.target === undefined &&
    node.provider !== true &&
    node.createAction === undefined &&
    node.children.length > 0
  );
}

type TopLevelRun =
  | { readonly kind: "section"; readonly node: NavNode }
  | { readonly kind: "entries"; readonly nodes: readonly [NavNode, ...NavNode[]] };

// Consecutive non-section entries share one <ul>, so the root gap only
// separates blocks and not every pair of top-level leaves.
function groupTopLevelRuns(nodes: readonly NavNode[]): readonly TopLevelRun[] {
  const runs: TopLevelRun[] = [];
  let entries: [NavNode, ...NavNode[]] | undefined;
  for (const node of nodes) {
    if (isPureSection(node)) {
      entries = undefined;
      runs.push({ kind: "section", node });
    } else if (entries === undefined) {
      entries = [node];
      runs.push({ kind: "entries", nodes: entries });
    } else {
      entries.push(node);
    }
  }
  return runs;
}

type NavSubProps = {
  readonly node: NavNode;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (qn: string) => void;
};

// If the label contains a dot, pass it through t(): the bundle translates
// the key; otherwise the key remains visible as a reminder of a missing
// translation. Literal string labels are left unchanged.
function useLabel(node: NavNode): string {
  const t = useTranslation();
  return node.label.includes(".") ? t(node.label) : node.label;
}

// Without an icon only the collapsed rail shows the initial letter; expanded,
// the label stands alone.
function NavLeadingIcon({
  node,
  active,
  expanded = false,
  label,
}: {
  node: NavNode;
  active: boolean;
  expanded?: boolean;
  /** Only needed for the rail fallback — see below. */
  label?: string;
}): ReactNode {
  const iconKey = expanded && node.icon === "folder" ? "folder-open" : node.icon;
  const isKnownIcon = iconKey !== undefined && Object.hasOwn(NAV_ICONS, iconKey);
  const NavIcon = iconKey !== undefined && isKnownIcon ? NAV_ICON_LOOKUP[iconKey] : undefined;
  useEffect(() => {
    if (iconKey !== undefined && !isKnownIcon) {
      rendererWarn(
        `[kumiko] Nav entry "${node.qualifiedName}" references icon "${iconKey}", which is not ` +
          `registered in NAV_ICONS — falling back to the dot indicator. Check the icon key spelling.`,
      );
    }
  }, [iconKey, isKnownIcon, node.qualifiedName]);
  if (NavIcon !== undefined) return <NavIcon aria-hidden="true" className="shrink-0" />;
  const initial = label?.trim().charAt(0).toUpperCase();
  if (initial === undefined || initial === "") return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "hidden size-4 shrink-0 items-center justify-center font-medium text-xs group-data-[collapsible=icon]:flex",
        active ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/70",
      )}
    >
      {initial}
    </span>
  );
}

// A stable empty-list reference prevents a new `[]` on every render from
// destabilizing the SSE subscription's useEffect dependencies.
const EMPTY_ENTITY_LIST: readonly string[] = [];

// Active targets require an exact featureId and action match, with shallow
// equality for args (currently primitives only). This mirrors the former
// TreeNodeRenderer.
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

// Adapts provider-emitted TreeNodes to renderable NavNodes. Synthetic QNs use
// the parent QN and index label, remaining stable as long as emit order is
// stable. Static children are converted recursively. ponytail: a
// TreeChildrenSubscribe-Function supplied as children is treated as a leaf;
// nested dynamic providers have no consumer today. The upgrade path is to
// register synthetic QNs when such a provider emits them.
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

// Lazy provider children with SSE live refresh for a `provider: true` node.
// Subscription starts only when the node is expanded (enabled). The
// treeEntities list, keyed by QN, re-fires the provider on entity events so
// newly created nodes appear live. The logic mirrors VisualTree.ProviderBranch.
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
  // A live refresh keeps the current nodes on screen instead of blanking them.
  const keepNodesOnRefire = useRef(false);

  useEffect(() => {
    if (!enabled || entities.length === 0) return;
    const scheduler = createLiveRefetchScheduler(() => {
      keepNodesOnRefire.current = true;
      setAttempt((n) => n + 1);
    });
    const unsubs = entities.map((e) => subscribeLive(e, scheduler.trigger));
    return () => {
      for (const u of unsubs) u();
      scheduler.dispose();
    };
  }, [enabled, entities, subscribeLive]);

  // `attempt` triggers an SSE refresh and a new subscription, although Biome
  // cannot see its use in the body; semantically, it is the refire trigger.
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
    if (!keepNodesOnRefire.current) setRaw(null);
    keepNodesOnRefire.current = false;
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
  // Narrower than `active`: true only for the node that IS the routed
  // screen — never for a parent-fallback match. Drives aria-current="page".
  readonly ariaCurrent: boolean;
  readonly childNodes: readonly NavNode[];
  readonly hidden: boolean;
  readonly providerLoading: boolean;
  readonly providerError: string | null;
  readonly workspaceId: string | undefined;
};

// Shared node logic for top-level (NavMenuNode) and nested (NavSubNode)
// nodes: labels, expansion, active state (screen or target), and lazy provider
// children. The two renderers differ only in their shadcn primitives.
function useNavNodeState(node: NavNode, collapsed: ReadonlySet<string>): NavNodeState {
  const nav = useNav();
  const { q: filterQ, matches } = useContext(NavFilterContext);
  const filterActive = filterQ !== "";
  const displayLabel = useLabel(node);
  const isCollapsed = collapsed.has(node.qualifiedName);
  const expandable = node.children.length > 0 || node.provider === true;
  // An active filter expands every container so matches inside collapsed
  // folders become visible and provider children can load.
  const isExpanded = expandable && (!isCollapsed || filterActive);
  const { nodes: providerChildren, error: providerError } = useNavProviderChildren(
    node.qualifiedName,
    node.provider === true && isExpanded,
  );
  const activeTarget = useMemo(
    () => parseTargetFromSearchParams(nav.searchParams),
    [nav.searchParams],
  );
  const activeMarker = useContext(ActiveScreenMarkerContext);
  const screenActive =
    node.screen !== undefined &&
    activeMarker !== undefined &&
    lastSegment(node.screen) === activeMarker.screenId;
  const screenIsExactMatch = screenActive && activeMarker?.exact === true;
  const targetActive = node.target !== undefined && targetsEqual(node.target, activeTarget);
  const childNodes = node.provider === true ? (providerChildren ?? []) : node.children;
  const visibleChildNodes = filterActive
    ? childNodes.filter((c) => subtreeMatches(c, matches))
    : childNodes;
  return {
    displayLabel,
    isCollapsed,
    expandable,
    isExpanded,
    active: screenActive || targetActive,
    ariaCurrent: screenIsExactMatch || targetActive,
    childNodes: visibleChildNodes,
    // A filtered node is hidden only when neither it nor a visible child matches;
    // otherwise an empty folder header would remain.
    hidden: filterActive && !matches(node.label) && visibleChildNodes.length === 0,
    providerLoading: node.provider === true && isExpanded && providerChildren === null,
    providerError,
    workspaceId: nav.route?.workspaceId,
  };
}

// Action icon lookup: registered NAV_ICONS key → Lucide icon, otherwise the
// raw string as text (provider convention, no boot-fail on an unknown key).
function ActionGlyph({ icon }: { readonly icon: string }): ReactNode {
  const Icon = Object.hasOwn(NAV_ICONS, icon) ? NAV_ICON_LOOKUP[icon] : undefined;
  if (Icon !== undefined) return <Icon aria-hidden className="size-3.5" />;
  return (
    <span aria-hidden className="text-xs">
      {icon}
    </span>
  );
}

// Boot validates screen XOR target for NavDefinition actions, but a
// provider-emitted TreeNode reaches here without going through boot — warn
// once per label instead of rendering a dead button.
const warnedTreeActionLabels = new Set<string>();

function warnTreeActionMisconfigured(label: string, problem: string): void {
  const key = `${label}:${problem}`;
  // skip: already warned for this label and problem — suppresses the repeat, not the warning itself.
  if (warnedTreeActionLabels.has(key)) return;
  warnedTreeActionLabels.add(key);
  rendererWarn(`[kumiko] Nav action "${label}" ${problem}`);
}

// An action button carries screen XOR target (see TreeAction) — `screen`
// renders a KumikoLink to the route, `target` a dispatch button. Same
// classes/size either way, only the element changes.
function TreeActionControl({
  action,
  ariaLabel,
  className,
  dispatch,
  workspaceId,
  children,
}: {
  readonly action: TreeAction;
  readonly ariaLabel: string;
  readonly className: string;
  readonly dispatch: (target: TargetRef) => void;
  readonly workspaceId: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  // Authored actions are typed screen-XOR-target, but schemas can arrive
  // untyped over the wire — read both fields to stay defensive at runtime.
  const loose: { readonly screen?: string; readonly target?: TargetRef } = action;
  if (loose.screen !== undefined && loose.target !== undefined) {
    warnTreeActionMisconfigured(
      action.label,
      'has both "screen" and "target" set — using "screen", "target" is ignored.',
    );
  }
  if (loose.screen !== undefined) {
    const screenId = lastSegment(loose.screen);
    return (
      <KumikoLink
        to={{ ...(workspaceId !== undefined && { workspaceId }), screenId }}
        aria-label={ariaLabel}
        className={className}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </KumikoLink>
    );
  }
  if (loose.target !== undefined) {
    const target = loose.target;
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          dispatch(target);
        }}
      >
        {children}
      </button>
    );
  }
  warnTreeActionMisconfigured(
    action.label,
    'has neither "screen" nor "target" set — it will not render.',
  );
  return null;
}

// Hover-actions + the "+" affordance, positioned absolute right.
// createAction is persistent (a user-visible "+"), the other actions only
// show on hover. stopPropagation so the row click (toggle/dispatch) doesn't
// also fire. `expandable` comes from useNavNodeState (s.expandable) instead
// of being re-derived here — a node without a chevron doesn't need the
// right-7 gap, otherwise the "+" hangs 28px off the edge.
function NodeActions({
  node,
  expandable,
  workspaceId,
}: {
  readonly node: NavNode;
  readonly expandable: boolean;
  readonly workspaceId: string | undefined;
}): ReactNode {
  const dispatch = useDispatchTarget();
  const t = useTranslation();
  const create = node.createAction;
  const actions = node.actions ?? [];
  if (create === undefined && actions.length === 0) return null;
  const label = (s: string): string => (s.includes(".") ? t(s) : s);
  const btn =
    "flex size-5 items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const hover =
    "opacity-0 group-hover/menu-item:opacity-100 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-item:opacity-100";
  return (
    <div
      className={cn("absolute top-1 flex items-center gap-0.5", expandable ? "right-7" : "right-1")}
    >
      {create !== undefined && (
        <TreeActionControl
          action={create}
          ariaLabel={label(create.label)}
          className={btn}
          dispatch={dispatch}
          workspaceId={workspaceId}
        >
          <Plus className="size-3.5" />
        </TreeActionControl>
      )}
      {actions.map((a: TreeAction) => (
        <TreeActionControl
          key={a.label}
          action={a}
          ariaLabel={label(a.label)}
          className={cn(btn, hover)}
          dispatch={dispatch}
          workspaceId={workspaceId}
        >
          <ActionGlyph icon={a.icon} />
        </TreeActionControl>
      ))}
    </div>
  );
}

// Status lines within a provider sub-list (lazy loading or error).
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
    return <li className="px-2 py-1 text-xs text-sidebar-muted italic">Lädt …</li>;
  }
  return null;
}

// Top-level section: a SidebarGroup with a static label
// ("Platform"/"Projects" are fixed headings, not toggles). Collapse belongs
// on items with children, not on the section itself.
function NavSection({ node, collapsed, onToggle }: NavSubProps): ReactNode {
  const displayLabel = useLabel(node);
  const { q, matches } = useContext(NavFilterContext);
  // Provider children are statically empty until loaded, so they keep the
  // section visible; their matches cannot be checked statically, and the node
  // hides itself.
  if (
    q !== "" &&
    !matches(node.label) &&
    !node.children.some((c) => c.provider === true || subtreeMatches(c, matches))
  ) {
    return null;
  }
  return (
    <SidebarGroup>
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

// A menu entry (top-level item or section child) supports three click modes:
// `screen` is a route link (KumikoLink), `target` dispatches to EditorPanel
// (useDispatchTarget), and neither makes it a container/provider node that only
// expands or collapses. Provider nodes load children lazily with SSE refresh.
// The collapse chevron is a separate SidebarMenuAction because nesting a
// <button> inside an <a> would produce invalid HTML; createAction/actions are
// rendered as absolute NodeActions beside it.
function NavMenuNode({ node, collapsed, onToggle }: NavSubProps): ReactNode {
  const t = useTranslation();
  const dispatch = useDispatchTarget();
  const s = useNavNodeState(node, collapsed);
  if (s.hidden) return null;

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
      aria-label={t(s.isExpanded ? "kumiko.nav.collapse" : "kumiko.nav.expand")}
      aria-expanded={s.isExpanded}
      onClick={() => onToggle(node.qualifiedName)}
    >
      {s.isExpanded ? <ChevronDown /> : <ChevronRight />}
    </SidebarMenuAction>
  ) : null;

  if (node.screen !== undefined) {
    const screenId = lastSegment(node.screen);
    return (
      <SidebarMenuItem>
        {/* tooltip = the label that shadcn displays only in the collapsed icon state. */}
        <SidebarMenuButton asChild isActive={s.active} tooltip={s.displayLabel}>
          <KumikoLink
            to={{ ...(s.workspaceId !== undefined && { workspaceId: s.workspaceId }), screenId }}
            {...(s.ariaCurrent && { "aria-current": "page" })}
          >
            <NavLeadingIcon node={node} active={s.active} label={s.displayLabel} />
            <span
              className="min-w-0 truncate group-data-[collapsible=icon]:hidden"
              title={s.displayLabel}
            >
              {s.displayLabel}
            </span>
            <NavBadge node={node} />
          </KumikoLink>
        </SidebarMenuButton>
        <NodeActions node={node} expandable={s.expandable} workspaceId={s.workspaceId} />
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
          <NavLeadingIcon node={node} active={s.active} label={s.displayLabel} />
          <span
            className="min-w-0 truncate group-data-[collapsible=icon]:hidden"
            title={s.displayLabel}
          >
            {s.displayLabel}
          </span>
          <NavBadge node={node} />
        </SidebarMenuButton>
        <NodeActions node={node} expandable={s.expandable} workspaceId={s.workspaceId} />
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
        {...(s.expandable && { "aria-expanded": s.isExpanded })}
      >
        <NavLeadingIcon node={node} active={false} expanded={s.isExpanded} label={s.displayLabel} />
        <span className="truncate group-data-[collapsible=icon]:hidden" title={s.displayLabel}>
          {s.displayLabel}
        </span>
        {s.expandable &&
          (s.isExpanded ? (
            <ChevronDown className="ml-auto" />
          ) : (
            <ChevronRight className="ml-auto" />
          ))}
      </SidebarMenuButton>
      <NodeActions node={node} expandable={s.expandable} workspaceId={s.workspaceId} />
      {sub}
    </SidebarMenuItem>
  );
}

// Nested entries inside SidebarMenuSub use the same three click modes as
// NavMenuNode, with the sub-primitives. Folder/container nodes without a
// screen or target expand; provider children and deeper static nodes recurse.
// Non-link targets require asChild with <button> because SidebarMenuSubButton
// is an <a>; the chevron is a separate absolute button to avoid a button inside
// an anchor.
function NavSubNode({ node, collapsed, onToggle }: NavSubProps): ReactNode {
  const t = useTranslation();
  const dispatch = useDispatchTarget();
  const s = useNavNodeState(node, collapsed);
  if (s.hidden) return null;

  // Children go in their own SidebarMenuSub (<ul>): a sub-item is an <li>, so
  // nested <li> elements without an intervening <ul> would be invalid HTML
  // (for example, nested content folders such as Marketing/ > Block). The
  // <ul> also supplies the indentation and border level for each depth.
  const deeper = s.isExpanded ? (
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
    <button
      type="button"
      aria-label={t(s.isExpanded ? "kumiko.nav.collapse" : "kumiko.nav.expand")}
      aria-expanded={s.isExpanded}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(node.qualifiedName);
      }}
      className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      {s.isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
    </button>
  ) : null;

  if (node.screen !== undefined) {
    const screenId = lastSegment(node.screen);
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton asChild isActive={s.active}>
          <KumikoLink
            to={{ ...(s.workspaceId !== undefined && { workspaceId: s.workspaceId }), screenId }}
            {...(s.ariaCurrent && { "aria-current": "page" })}
          >
            <NavLeadingIcon node={node} active={s.active} label={s.displayLabel} />
            <span
              className="min-w-0 truncate group-data-[collapsible=icon]:hidden"
              title={s.displayLabel}
            >
              {s.displayLabel}
            </span>
            <NavBadge node={node} />
          </KumikoLink>
        </SidebarMenuSubButton>
        <NodeActions node={node} expandable={s.expandable} workspaceId={s.workspaceId} />
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
            <NavLeadingIcon node={node} active={s.active} label={s.displayLabel} />
            <span
              className="min-w-0 truncate group-data-[collapsible=icon]:hidden"
              title={s.displayLabel}
            >
              {s.displayLabel}
            </span>
            <NavBadge node={node} />
          </button>
        </SidebarMenuSubButton>
        <NodeActions node={node} expandable={s.expandable} workspaceId={s.workspaceId} />
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
          <NavLeadingIcon
            node={node}
            active={false}
            expanded={s.isExpanded}
            label={s.displayLabel}
          />
          <span className="truncate group-data-[collapsible=icon]:hidden" title={s.displayLabel}>
            {s.displayLabel}
          </span>
        </button>
      </SidebarMenuSubButton>
      <NodeActions node={node} expandable={s.expandable} workspaceId={s.workspaceId} />
      {chevron}
      {deeper}
    </SidebarMenuSubItem>
  );
}

// Backward-compatible single-feature builder. This convenience wrapper around
// buildNavRegistrySliceForApp lets existing tests that call it with
// FeatureSchema remain unchanged.
export function buildNavRegistrySlice(
  schema: FeatureSchema,
  allowedNavQns?: ReadonlySet<string>,
): NavRegistrySlice {
  return buildNavRegistrySliceForApp(toAppSchema(schema), allowedNavQns);
}

// Multi-feature variant. Iterates over all features, qualifying each entry
// with its own featureName. Feature order follows AppSchema, and nav order
// follows each feature's declaration order.
//
// Cross-feature workspaces are supported natively: `navMembers` reference QNs,
// and the filter selects the correct entries regardless of their feature.
export function buildNavRegistrySliceForApp(
  app: AppSchema,
  allowedNavQns?: ReadonlySet<string>,
): NavRegistrySlice {
  const screenAccessByQn = buildScreenAccessMap(app);
  const qualified: NavDefinition[] = [];
  for (const feature of app.features) {
    for (const n of feature.navs ?? []) {
      const screen =
        n.screen !== undefined ? qualifyScreenId(feature.featureName, n.screen) : undefined;
      // Nav entries without their own `access` inherit the referenced
      // screen's access rule — otherwise a broader workspace/parent access
      // lets a role see a nav entry whose target screen 403s them.
      // An explicit `n.access` always wins; inheritance only fills the gap.
      const inheritedAccess =
        n.access ?? (screen !== undefined ? screenAccessByQn.get(screen) : undefined);
      qualified.push({
        ...n,
        id: qualifyNavId(feature.featureName, n.id),
        ...(n.parent !== undefined && { parent: qualifyNavId(feature.featureName, n.parent) }),
        ...(screen !== undefined && { screen }),
        ...(inheritedAccess !== undefined && { access: inheritedAccess }),
      });
    }
  }
  const existing = dropNavsWithNonexistentParent(qualified);
  // Workspace filter: drop nav entries whose qualified id isn't in the
  // allow-set. A child whose parent gets dropped surfaces as a top-level
  // entry — the workspace owner should list parents explicitly if they
  // want the grouping preserved.
  const filtered =
    allowedNavQns !== undefined ? existing.filter((n) => allowedNavQns.has(n.id)) : existing;
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

// A parent absent from the (role-projected) schema is not a workspace
// filter result: the child must not leak to the top level. Transitive.
// Parents removed by an allowlist (filterAppSchemaNavsByAllowlist) are not
// absent here: that helper already lifted their children to the top level.
function dropNavsWithNonexistentParent(navs: readonly NavDefinition[]): NavDefinition[] {
  let current = [...navs];
  for (;;) {
    const ids = new Set(current.map((n) => n.id));
    const kept = current.filter((n) => n.parent === undefined || ids.has(n.parent));
    if (kept.length === current.length) return current;
    current = kept;
  }
}

// Exported (not part of the package's public index.ts surface) so other
// modules under layout/ — e.g. filter-app-schema-navs.ts — qualify nav ids
// the same way instead of keeping a second copy in sync.
export function qualifyNavId(feature: string, id: string): string {
  return id.includes(":nav:") ? id : `${feature}:nav:${id}`;
}

function qualifyScreenId(feature: string, id: string): string {
  return id.includes(":screen:") ? id : `${feature}:screen:${id}`;
}

function buildScreenAccessMap(app: AppSchema): Map<string, AccessRule | undefined> {
  const map = new Map<string, AccessRule | undefined>();
  for (const feature of app.features) {
    for (const s of feature.screens) {
      map.set(qualifyScreenId(feature.featureName, s.id), s.access);
    }
  }
  return map;
}

// `lastSegment` now lives in @cosmicdrift/kumiko-renderer (./app/qn), giving
// both packages a shared implementation.
export { lastSegment };
