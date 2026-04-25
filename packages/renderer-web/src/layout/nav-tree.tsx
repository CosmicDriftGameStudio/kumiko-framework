// NavTree: Sidebar-Navigation aus dem Schema. Multi-Feature-aware —
// jedes Feature trägt seinen Featurenamen, der zum Qualifizieren der
// nav-ids genutzt wird. Pre-qualifizierte ids (enthält schon ":nav:")
// gehen unverändert durch — so können einzelne Features Cross-Feature-
// Referenzen einfügen ohne zur AppSchema migrieren zu müssen.
//
// Aktiver Eintrag bekommt die accent-Farben (hintergrund + foreground),
// inaktive nur muted-foreground. Rekursiv mit Indentation pro Tiefe.

import type { NavDefinition } from "@kumiko/framework/ui-types";
import type { NavNode, NavRegistrySlice } from "@kumiko/headless";
import { resolveNavigation } from "@kumiko/headless";
import type { AppSchema, FeatureSchema } from "@kumiko/renderer";
import { toAppSchema, useNav, useTranslation } from "@kumiko/renderer";
import { type ReactNode, useMemo } from "react";
import { KumikoLink } from "../app/nav";
import { cn } from "../lib/cn";

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
  return (
    <div data-testid={testId} data-kumiko-layout="nav-tree" className="flex flex-col gap-0.5">
      {tree.map((node) => (
        <NavNodeItem key={node.qualifiedName} node={node} depth={0} />
      ))}
    </div>
  );
}

function NavNodeItem({
  node,
  depth,
}: {
  readonly node: NavNode;
  readonly depth: number;
}): ReactNode {
  const nav = useNav();
  const t = useTranslation();
  const active = node.screen !== undefined && nav.route?.screenId === lastSegment(node.screen);

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

  if (node.screen !== undefined) {
    const screenId = lastSegment(node.screen);
    return (
      <>
        <KumikoLink
          to={{ ...(workspaceId !== undefined && { workspaceId }), screenId }}
          style={indent}
          className={cn(
            "flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
          )}
        >
          {displayLabel}
        </KumikoLink>
        {node.children.length > 0 &&
          node.children.map((child) => (
            <NavNodeItem key={child.qualifiedName} node={child} depth={depth + 1} />
          ))}
      </>
    );
  }
  return (
    <>
      <div
        style={indent}
        className="px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground"
      >
        {displayLabel}
      </div>
      {node.children.map((child) => (
        <NavNodeItem key={child.qualifiedName} node={child} depth={depth + 1} />
      ))}
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

// Strip qualifying prefix off a QN ("feature:nav:my-screen" → "my-screen").
// Exported because workspace-shell builds nav targets from the same QN
// shape and a duplicate copy would drift.
export function lastSegment(qn: string): string {
  const idx = qn.lastIndexOf(":");
  return idx < 0 ? qn : qn.slice(idx + 1);
}
