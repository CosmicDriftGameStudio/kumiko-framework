import type { CSSProperties, ReactNode } from "react";
import type { AppSchema, FeatureSchema } from "../../index.ts";
import { useSidebar } from "../ui/sidebar.tsx";
import { FocusRail } from "./focus-rail.tsx";
import type { ShellFocusHost } from "./shell-focus.tsx";

// 3.5rem = the 56px rail of the focused screen; the default icon width stays 3rem.
const FOCUS_RAIL_WIDTH_STYLE: CSSProperties = { "--sidebar-width-icon": "3.5rem" };

/** SidebarProvider props that hand the rail state to the focus host while a screen holds focus mode. */
export function focusSidebarProviderProps(focus: ShellFocusHost) {
  if (!focus.focused) return {};
  return {
    open: focus.railOpen,
    onOpenChange: focus.setRailOpen,
    style: FOCUS_RAIL_WIDTH_STYLE,
  };
}

/** Swaps the whole sidebar content for the focus rail while focused and collapsed on desktop. */
export function FocusAwareSidebarBody({
  focused,
  brand,
  schema,
  user,
  allowedNavQns,
  children,
}: {
  readonly focused: boolean;
  readonly brand: ReactNode;
  readonly schema: AppSchema | FeatureSchema;
  readonly user: { readonly id: string; readonly roles: readonly string[] } | undefined;
  readonly allowedNavQns?: ReadonlySet<string> | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const { state, isMobile } = useSidebar();
  if (focused && state === "collapsed" && !isMobile) {
    return (
      <FocusRail
        brand={brand}
        schema={schema}
        {...(user !== undefined && { user })}
        {...(allowedNavQns !== undefined && { allowedNavQns })}
      />
    );
  }
  return children;
}
