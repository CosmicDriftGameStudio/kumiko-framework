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
  TreeNode,
  TreeNodeState,
} from "@cosmicdrift/kumiko-framework/engine";
import { ChevronDown, ChevronRight, File, Folder, Plus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { useDispatchTarget } from "./target-resolver-stub";

// Icon-Registry (V.1.2-Stub): Provider liefern symbolische String-Keys
// (`node.icon = "folder"`), Renderer mappt auf das lucide-Component.
// Unknown Keys → kein Render (sauber leerer Slot, kein plain-string-
// Overlap im 14px-Container). V.1.3+ erweitert Registry um App-
// erweiterbare Custom-Icons; aktuelles Set deckt Tree-Folder/File-Bedarf
// vom V.1.2-Consumer (text-content groupBlocksBySlugPrefix → "folder")
// und legal-pages-Slugs (no icon set).
const NODE_ICONS: Readonly<Record<string, typeof Folder>> = {
  folder: Folder,
  file: File,
};

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

// TypeGuard für TreeChildrenSubscribe-Form. Nach `Array.isArray()`-check
// kann TS den Function-Branch nicht automatisch narrowen, daher dieser
// explizite Guard statt `as`-Cast (siehe Memory `[Type Assertions]` und
// build-target.ts:isArgsObject als Vorbild).
function isSubscribeFn(c: readonly TreeNode[] | TreeChildrenSubscribe): c is TreeChildrenSubscribe {
  return typeof c === "function";
}

export type TreeNodeRendererProps = {
  readonly node: TreeNode;
  readonly path: string;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
  readonly depth?: number;
};

export function TreeNodeRenderer({
  node,
  path,
  expanded,
  onToggle,
  depth = 0,
}: TreeNodeRendererProps): ReactNode {
  const isExpanded = expanded.has(path);
  const hasChildren = node.children !== undefined;

  // Dynamic-Children-Subscribe: nur wenn ausgeklappt UND Function-Form.
  // null = noch nicht emitted (zeige loading), Array = letzter Emit.
  //
  // **Identity-Assumption** (TODO V.1.2 verifizieren mit echtem Provider):
  // node.children muss als Function-Reference stabil über Re-Renders sein,
  // sonst trigger der useEffect ständig unsubscribe+resubscribe ("re-
  // subscribe-Storm"). Recommended-Pattern für Provider-Authors: Function
  // als top-level-const oder useMemo'd, NICHT inline-Closure pro Emit.
  // Bei first violation in V.1.2 entweder useMemo hier oder path-Cache
  // im VisualTree-Top-Level — Entscheidung wenn realer Trigger sichtbar.
  const [dynamicChildren, setDynamicChildren] = useState<readonly TreeNode[] | null>(null);
  useEffect(() => {
    if (!isExpanded) return;
    if (node.children === undefined) return;
    if (!isSubscribeFn(node.children)) return; // static-Array-Pfad in ChildrenView
    const subscribe = node.children();
    const unsubscribe = subscribe(setDynamicChildren);
    return unsubscribe;
  }, [isExpanded, node.children]);

  const stateClass = STATE_CLASSES[node.state ?? "filled"];
  const indentStyle = { paddingLeft: `${depth * 12 + 8}px` };
  const dispatch = useDispatchTarget();

  const handleRowClick = (): void => {
    if (hasChildren) {
      onToggle(path);
      return;
    }
    if (node.target !== undefined) {
      dispatch(node.target);
    }
  };

  return (
    <div data-kumiko-tree-node={path}>
      {/* Outer Row als <div role="button"> statt <button>: native <button>
          darf laut HTML-Spec keine geschachtelten <button>-Children
          enthalten — die HoverActions würden sonst ungültiges HTML
          erzeugen. role+tabIndex+keyDown gibt äquivalente a11y. TODO V.1.2:
          Arrow-key-navigation zwischen Tree-Siblings (ARIA-tree-Pattern). */}
      {/* biome-ignore lint/a11y/useSemanticElements: nested <button> wäre invalid HTML — siehe HoverActions */}
      <div
        className={cn(
          "group flex w-full items-center gap-1.5 py-1 pr-2 cursor-pointer hover:bg-accent/30 rounded-sm",
          stateClass,
        )}
        style={indentStyle}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleRowClick();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={hasChildren ? isExpanded : undefined}
      >
        <ChevronGlyph hasChildren={hasChildren} expanded={isExpanded} />
        {node.icon !== undefined &&
          (() => {
            const IconComponent = NODE_ICONS[node.icon];
            if (IconComponent === undefined) return null;
            return <IconComponent aria-hidden className="size-3.5 shrink-0" />;
          })()}
        <span className="flex-1 truncate text-sm">{node.label}</span>
        <HoverActions
          actions={node.actions}
          createAction={node.state === "empty" ? node.createAction : undefined}
        />
      </div>
      {isExpanded && (
        <ChildrenView
          node={node}
          path={path}
          expanded={expanded}
          onToggle={onToggle}
          depth={depth}
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
  const dispatch = useDispatchTarget();
  return (
    <button
      type="button"
      aria-label={action.label}
      className="p-0.5 hover:bg-accent rounded"
      onClick={(e) => {
        // Stop the event so the parent-row's onClick (which would
        // toggle / dispatch the row's own target) doesn't fire.
        e.stopPropagation();
        dispatch(action.target);
      }}
    >
      {icon}
    </button>
  );
}

function ChildrenView({
  node,
  path,
  expanded,
  onToggle,
  depth,
  dynamicChildren,
}: {
  readonly node: TreeNode;
  readonly path: string;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
  readonly depth: number;
  readonly dynamicChildren: readonly TreeNode[] | null;
}): ReactNode {
  // Array.isArray narrow't TS automatisch auf readonly TreeNode[] — kein
  // as-Cast nötig (Memory `[Type Assertions]`).
  if (Array.isArray(node.children)) {
    const children = node.children;
    return (
      <>
        {children.map((child, idx) => {
          // Path: idx als stabiler Disambiguator falls Provider doppelte
          // Labels liefert (Provider-Bug, aber React-Keys müssen unique
          // sein sonst silent state-corruption). Provider-Liefer-Order
          // ist stabil — idx ist hier kein „array-shift"-Risk wie bei
          // user-rearrangeable Lists.
          const childPath = `${path}/${idx}-${child.label}`;
          return (
            <TreeNodeRenderer
              key={childPath}
              node={child}
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
        // Selbe idx-Disambiguator-Logik wie ChildrenView static-Branch.
        const childPath = `${path}/${idx}-${child.label}`;
        return (
          <TreeNodeRenderer
            key={childPath}
            node={child}
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
