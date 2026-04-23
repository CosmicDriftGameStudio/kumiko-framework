// NavTree: Sidebar-Navigation aus dem Feature-Schema. Rekursiv mit
// Indentation pro Tiefe. Aktiver Eintrag bekommt die accent-Farben
// (hintergrund + foreground), inaktive nur muted-foreground.

import type { NavDefinition } from "@kumiko/framework/ui-types";
import type { NavNode, NavRegistrySlice } from "@kumiko/headless";
import { resolveNavigation } from "@kumiko/headless";
import type { FeatureSchema } from "@kumiko/renderer";
import { useNav } from "@kumiko/renderer";
import { type ReactNode, useMemo } from "react";
import { KumikoLink } from "../app/nav";
import { cn } from "../lib/cn";

export type NavTreeProps = {
  readonly schema: FeatureSchema;
  readonly user?: { readonly id: string; readonly roles: readonly string[] };
  readonly testId?: string;
};

export function NavTree({ schema, user, testId }: NavTreeProps): ReactNode {
  const tree = useMemo(() => {
    const source = buildNavRegistrySlice(schema);
    return resolveNavigation({ source, ...(user !== undefined && { user }) });
  }, [schema, user]);
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
  const active = node.screen !== undefined && nav.route?.screenId === lastSegment(node.screen);

  const indent = { paddingLeft: `${0.5 + depth * 1}rem` };

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
          {node.label}
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
        {node.label}
      </div>
      {node.children.map((child) => (
        <NavNodeItem key={child.qualifiedName} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function buildNavRegistrySlice(schema: FeatureSchema): NavRegistrySlice {
  const qualified: NavDefinition[] = (schema.navs ?? []).map((n) => ({
    ...n,
    id: qualifyNavId(schema.featureName, n.id),
    ...(n.parent !== undefined && { parent: qualifyNavId(schema.featureName, n.parent) }),
    ...(n.screen !== undefined && { screen: qualifyScreenId(schema.featureName, n.screen) }),
  }));
  const topLevel: NavDefinition[] = [];
  const byParentMap = new Map<string, NavDefinition[]>();
  for (const nav of qualified) {
    if (nav.parent !== undefined) {
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
