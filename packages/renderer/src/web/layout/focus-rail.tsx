// The collapsed rail of a focused screen: brand tile plus one icon per top-level nav node.
// Sections have no screen of their own, so their icon expands the sidebar instead of navigating.

import { type Folder, MoreHorizontal } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import type { NavNode } from "../../headless/index.ts";
import { resolveNavigation } from "../../headless/index.ts";
import type { AppSchema, FeatureSchema } from "../../index.ts";
import { lastSegment, toAppSchema, useNav, useTranslation } from "../../index.ts";
import { KumikoLink } from "../app/nav.tsx";
import { NAV_ICONS } from "../icons.tsx";
import { useSidebar } from "../ui/sidebar.tsx";
import { buildNavRegistrySliceForApp, treeContainsScreen } from "./nav-tree.tsx";
import { resolveParentScreenId } from "./shell-breadcrumb.ts";
import { useDispatchTarget } from "./target-resolver-stub.tsx";

const NAV_ICON_LOOKUP: Readonly<Record<string, typeof Folder | undefined>> = NAV_ICONS;

const RAIL_TILE_CLASS =
  "flex size-10 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 text-sidebar-muted outline-hidden transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground";

export type FocusRailProps = {
  readonly brand: ReactNode;
  readonly schema: AppSchema | FeatureSchema;
  readonly user?: { readonly id: string; readonly roles: readonly string[] };
  readonly allowedNavQns?: ReadonlySet<string>;
  /** Top-level nav QNs that get a rail tile; the rest sit behind a "More" tile. Unset: all of them. */
  readonly railNavQns?: readonly string[];
  /** The sidebar footer (e.g. the sidebar UserMenu), pinned to the bottom of the rail. */
  readonly footer?: ReactNode;
};

function RailGlyph({ node, label }: { readonly node: NavNode; readonly label: string }): ReactNode {
  const Icon =
    node.icon !== undefined && Object.hasOwn(NAV_ICONS, node.icon)
      ? NAV_ICON_LOOKUP[node.icon]
      : undefined;
  if (Icon !== undefined) return <Icon aria-hidden="true" className="size-[18px]" />;
  return (
    <span aria-hidden="true" className="text-sm font-semibold">
      {label.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function useActiveScreenId(
  tree: readonly NavNode[],
  schema: AppSchema | FeatureSchema,
): string | undefined {
  const nav = useNav();
  const routedScreenId = nav.route?.screenId;
  return useMemo(() => {
    if (routedScreenId === undefined) return undefined;
    if (treeContainsScreen(tree, routedScreenId)) return routedScreenId;
    const screens = toAppSchema(schema).features.flatMap((feature) => feature.screens);
    return resolveParentScreenId(screens, routedScreenId);
  }, [tree, schema, routedScreenId]);
}

function RailTile({
  node,
  active,
}: {
  readonly node: NavNode;
  readonly active: boolean;
}): ReactNode {
  const t = useTranslation();
  const dispatchTarget = useDispatchTarget();
  const { setOpen } = useSidebar();
  const label = node.label.includes(".") ? t(node.label) : node.label;
  const glyph = <RailGlyph node={node} label={label} />;
  if (node.screen !== undefined) {
    return (
      <KumikoLink
        to={{ screenId: lastSegment(node.screen) }}
        title={label}
        aria-label={label}
        data-active={active}
        {...(active && { "aria-current": "page" as const })}
        className={RAIL_TILE_CLASS}
      >
        {glyph}
      </KumikoLink>
    );
  }
  const target = node.target;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-active={active}
      className={RAIL_TILE_CLASS}
      onClick={() => (target !== undefined ? dispatchTarget(target) : setOpen(true))}
    >
      {glyph}
    </button>
  );
}

export function FocusRail({
  brand,
  schema,
  user,
  allowedNavQns,
  railNavQns,
  footer,
}: FocusRailProps): ReactNode {
  const t = useTranslation();
  const { setOpen } = useSidebar();
  const tree = useMemo(() => {
    const source = buildNavRegistrySliceForApp(toAppSchema(schema), allowedNavQns);
    return resolveNavigation({ source, ...(user !== undefined && { user }) });
  }, [schema, user, allowedNavQns]);
  const activeScreenId = useActiveScreenId(tree, schema);
  const isActive = (node: NavNode): boolean =>
    activeScreenId !== undefined && treeContainsScreen([node], activeScreenId);
  const shown =
    railNavQns === undefined ? tree : tree.filter((n) => railNavQns.includes(n.qualifiedName));
  const hidden = tree.filter((node) => !shown.includes(node));
  const moreLabel = t("kumiko.focusRail.more");

  return (
    <div
      data-kumiko-layout="focus-rail"
      data-focus-rail=""
      className="group/focus-rail flex h-full flex-col items-center px-2 py-3"
    >
      {brand}
      <nav className="flex flex-col items-center gap-1">
        {shown.map((node) => (
          <RailTile key={node.qualifiedName} node={node} active={isActive(node)} />
        ))}
      </nav>
      <div className="mt-auto flex w-full flex-col items-center gap-1">
        {hidden.length > 0 && (
          // The full sidebar holds every entry, so "More" opens it instead of a second menu.
          <button
            type="button"
            title={moreLabel}
            aria-label={moreLabel}
            data-active={hidden.some(isActive)}
            className={RAIL_TILE_CLASS}
            onClick={() => setOpen(true)}
          >
            <MoreHorizontal aria-hidden="true" className="size-[18px]" />
          </button>
        )}
        {footer !== undefined && (
          <div data-kumiko-layout="focus-rail-footer" className="w-full">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
