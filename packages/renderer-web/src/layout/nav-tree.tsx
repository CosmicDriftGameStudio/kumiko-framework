// NavTree: Sidebar-Navigation aus dem Feature-Schema. Rekursiv mit
// Indentation pro Tiefe. Aktiver Eintrag bekommt die accent-Farben
// (hintergrund + foreground), inaktive nur muted-foreground.

import type { NavDefinition } from "@kumiko/framework/ui-types";
import type { NavNode, NavRegistrySlice } from "@kumiko/headless";
import { resolveNavigation } from "@kumiko/headless";
import type { FeatureSchema } from "@kumiko/renderer";
import { useNav, useTranslation } from "@kumiko/renderer";
import { type ReactNode, useMemo } from "react";
import { KumikoLink } from "../app/nav";
import { cn } from "../lib/cn";

export type NavTreeProps = {
  readonly schema: FeatureSchema;
  readonly user?: { readonly id: string; readonly roles: readonly string[] };
  readonly testId?: string;
  // Workspace membership filter — when set, only nav entries whose qualified
  // id is in the set are visible. WorkspaceShell passes the active
  // workspace's `navMembers` list. Undefined = no filter (legacy / non-
  // workspace apps render every nav).
  readonly allowedNavQns?: ReadonlySet<string>;
};

export function NavTree({ schema, user, testId, allowedNavQns }: NavTreeProps): ReactNode {
  const tree = useMemo(() => {
    const source = buildNavRegistrySlice(schema, allowedNavQns);
    return resolveNavigation({ source, ...(user !== undefined && { user }) });
  }, [schema, user, allowedNavQns]);
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

  if (node.screen !== undefined) {
    const screenId = lastSegment(node.screen);
    return (
      <>
        <KumikoLink
          to={{ screenId }}
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

export function buildNavRegistrySlice(
  schema: FeatureSchema,
  allowedNavQns?: ReadonlySet<string>,
): NavRegistrySlice {
  const qualified: NavDefinition[] = (schema.navs ?? []).map((n) => ({
    ...n,
    id: qualifyNavId(schema.featureName, n.id),
    ...(n.parent !== undefined && { parent: qualifyNavId(schema.featureName, n.parent) }),
    ...(n.screen !== undefined && { screen: qualifyScreenId(schema.featureName, n.screen) }),
  }));
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

function lastSegment(qn: string): string {
  const idx = qn.lastIndexOf(":");
  return idx < 0 ? qn : qn.slice(idx + 1);
}
