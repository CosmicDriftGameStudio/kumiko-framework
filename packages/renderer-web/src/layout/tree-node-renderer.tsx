// TreeNodeRenderer — recursive Pro-Knoten-Component für den Visual-Tree.
//
// **Pflichten** (visual-tree.md V.1.1-C):
//   1. Render `[icon] [label] [actions]` row mit State-abhängigen Klassen
//   2. Click-Dispatch: onClick mit gesetztem `node.target` → dispatchTarget
//   3. Hover-Actions rechts (CSS-only, hover-visible)
//   4. Children rekursiv: static-Array direkt, TreeChildrenSubscribe lazy
//      mit subscribe/unsubscribe an expand/collapse
//   5. Skeleton-Affordance: state="empty" + createAction → automatic
//      "+"-Icon, dispatcht createAction.target
//
// **Expand-State** lebt nicht hier sondern im VisualTree (Top-Level)
// damit localStorage-Persistenz pro Workspace eine Stelle hat. Renderer
// kriegt `expanded: Set<path>` + `onToggle(path)` als Props.
//
// **Path** = Workspace-eindeutiger String (parent-path + child-index oder
// node.label-segment). Stable über Re-Renders, eindeutig pro Knoten.
//
// Siehe visual-tree.md V.1.1-C + A4 (TreeNode-Type-Definition).

import type {
  TreeAction,
  TreeChildrenSubscribe,
  TreeContext,
  TreeNode,
  TreeNodeState,
} from "@cosmicdrift/kumiko-framework/engine";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { dispatchTarget } from "./target-resolver-stub";

// State → Tailwind-Klassen-Mapping. „filled" ist no-op (default-text).
// Restliche Werte signalisieren visuell: stub = leise, empty = stark
// gedimmt + italic, loading = pulse-animation, error = destruktiv-Farbe.
const STATE_CLASSES: Readonly<Record<TreeNodeState, string>> = {
  filled: "",
  stub: "opacity-55",
  empty: "opacity-50 italic",
  loading: "animate-pulse",
  error: "text-destructive",
};

export type TreeNodeRendererProps = {
  readonly node: TreeNode;
  readonly ctx: TreeContext;
  readonly path: string;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
  readonly depth?: number;
};

export function TreeNodeRenderer({
  node,
  ctx,
  path,
  expanded,
  onToggle,
  depth = 0,
}: TreeNodeRendererProps): ReactNode {
  const isExpanded = expanded.has(path);
  const hasChildren = node.children !== undefined;
  const isStaticChildren = Array.isArray(node.children);

  // Dynamic-Children-Subscribe: nur wenn ausgeklappt UND Function-Form.
  // null = noch nicht emitted (zeige loading), Array = letzter Emit.
  const [dynamicChildren, setDynamicChildren] = useState<readonly TreeNode[] | null>(null);
  useEffect(() => {
    if (!isExpanded) return;
    if (node.children === undefined) return;
    if (Array.isArray(node.children)) return; // static path covered separat
    const subscribeFn = node.children as TreeChildrenSubscribe;
    const subscribe = subscribeFn(ctx);
    const unsubscribe = subscribe(setDynamicChildren);
    return unsubscribe;
  }, [isExpanded, node.children, ctx]);

  const stateClass = STATE_CLASSES[node.state ?? "filled"];
  const indentStyle = { paddingLeft: `${depth * 12 + 8}px` };

  const handleRowClick = (): void => {
    if (hasChildren) {
      onToggle(path);
      return;
    }
    if (node.target !== undefined) {
      dispatchTarget(node.target);
    }
  };

  return (
    <div data-kumiko-tree-node={path}>
      <button
        type="button"
        className={cn(
          "group flex w-full items-center gap-1.5 py-1 pr-2 cursor-pointer hover:bg-accent/30 rounded-sm bg-transparent border-0 text-left",
          stateClass,
        )}
        style={indentStyle}
        onClick={handleRowClick}
        aria-expanded={hasChildren ? isExpanded : undefined}
      >
        <ChevronGlyph hasChildren={hasChildren} expanded={isExpanded} />
        {node.icon !== undefined && (
          <span aria-hidden className="size-3.5">
            {node.icon}
          </span>
        )}
        <span className="flex-1 truncate text-sm">{node.label}</span>
        <HoverActions
          actions={node.actions}
          createAction={node.state === "empty" ? node.createAction : undefined}
        />
      </button>
      {isExpanded && (
        <ChildrenView
          node={node}
          ctx={ctx}
          path={path}
          expanded={expanded}
          onToggle={onToggle}
          depth={depth}
          isStaticChildren={isStaticChildren}
          dynamicChildren={dynamicChildren}
        />
      )}
    </div>
  );
}

function ChevronGlyph({
  hasChildren,
  expanded,
}: {
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}): ReactNode {
  if (!hasChildren) return <span aria-hidden className="size-3.5" />;
  return expanded ? (
    <ChevronDown aria-hidden className="size-3.5 shrink-0" />
  ) : (
    <ChevronRight aria-hidden className="size-3.5 shrink-0" />
  );
}

function HoverActions({
  actions,
  createAction,
}: {
  readonly actions?: readonly TreeAction[];
  readonly createAction?: TreeAction;
}): ReactNode {
  const has = (actions !== undefined && actions.length > 0) || createAction !== undefined;
  if (!has) return null;
  return (
    <span className="invisible group-hover:visible flex items-center gap-1 shrink-0">
      {createAction !== undefined && (
        <ActionButton action={createAction} icon={<Plus className="size-3.5" />} />
      )}
      {actions?.map((a) => (
        <ActionButton key={a.label} action={a} icon={<span aria-hidden>{a.icon}</span>} />
      ))}
    </span>
  );
}

function ActionButton({
  action,
  icon,
}: {
  readonly action: TreeAction;
  readonly icon: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={action.label}
      className="p-0.5 hover:bg-accent rounded"
      onClick={(e) => {
        // Stop the event so the parent-row's onClick (which would
        // toggle / dispatch the row's own target) doesn't fire.
        e.stopPropagation();
        dispatchTarget(action.target);
      }}
    >
      {icon}
    </button>
  );
}

function ChildrenView({
  node,
  ctx,
  path,
  expanded,
  onToggle,
  depth,
  isStaticChildren,
  dynamicChildren,
}: {
  readonly node: TreeNode;
  readonly ctx: TreeContext;
  readonly path: string;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
  readonly depth: number;
  readonly isStaticChildren: boolean;
  readonly dynamicChildren: readonly TreeNode[] | null;
}): ReactNode {
  if (isStaticChildren) {
    const children = node.children as readonly TreeNode[];
    return (
      <>
        {children.map((child, idx) => {
          // Path: idx als stabiler Disambiguator falls Provider doppelte
          // Labels liefert (Provider-Bug, aber React-Keys müssen unique
          // sein sonst silent state-corruption). Provider-Liefer-Order
          // ist stabil — idx ist hier kein „array-shift"-Risk wie bei
          // user-rearrangeable Lists.
          // biome-ignore lint/suspicious/noArrayIndexKey: idx ist Disambiguator gegen Label-Dups, nicht primary-key
          const childPath = `${path}/${idx}-${child.label}`;
          return (
            <TreeNodeRenderer
              key={childPath}
              node={child}
              ctx={ctx}
              path={childPath}
              expanded={expanded}
              onToggle={onToggle}
              depth={depth + 1}
            />
          );
        })}
      </>
    );
  }
  // Dynamic-children-Pfad: noch nicht emitted → Lade-Zeile, dann Liste.
  if (dynamicChildren === null) {
    return (
      <div
        className="text-xs text-muted-foreground italic py-1"
        style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
      >
        Lädt …
      </div>
    );
  }
  return (
    <>
      {dynamicChildren.map((child, idx) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: idx ist Disambiguator gegen Label-Dups, nicht primary-key (siehe ChildrenView static-Branch)
        const childPath = `${path}/${idx}-${child.label}`;
        return (
          <TreeNodeRenderer
            key={childPath}
            node={child}
            ctx={ctx}
            path={childPath}
            expanded={expanded}
            onToggle={onToggle}
            depth={depth + 1}
          />
        );
      })}
    </>
  );
}
