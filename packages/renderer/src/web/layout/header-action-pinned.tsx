import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { Children, Fragment, isValidElement, type ReactNode, useContext } from "react";
import { usePageHeaderCompact } from "../../index.ts";
import { HeaderOverflowMenuContext, HeaderScreenTypeContext } from "./header-overflow-menu.ts";

const LIST_SCREEN_TYPES: ReadonlySet<ScreenDefinition["type"]> = new Set([
  "entityList",
  "projectionList",
]);

/** Marks an app header action (e.g. the assistant trigger) that stays in the bar on a phone, next to the
 *  bell; the rest of `headerActions` folds into the "…" menu. Inside the menu it renders nothing.
 *  `hideOnListScreens` drops it on phone entityList/projectionList screens, whose rows carry their own AI action. */
export function HeaderActionPinned({
  children,
  hideOnListScreens = false,
}: {
  readonly children: ReactNode;
  readonly hideOnListScreens?: boolean;
}): ReactNode {
  const inMenu = useContext(HeaderOverflowMenuContext);
  const screenType = useContext(HeaderScreenTypeContext);
  const compact = usePageHeaderCompact();
  const onListScreen = screenType !== undefined && LIST_SCREEN_TYPES.has(screenType);
  return inMenu || (hideOnListScreens && compact && onListScreen) ? null : children;
}

function isPinnedElement(node: ReactNode): boolean {
  return isValidElement(node) && node.type === HeaderActionPinned;
}

// Pinned markers are found in the JSX tree handed to the shell (fragments and arrays included); a marker
// hidden inside another component's render output is not seen.
function flattenFragments(node: ReactNode): readonly ReactNode[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flattenFragments(child.props.children)
      : [child],
  );
}

export function collectPinnedHeaderActions(node: ReactNode): readonly ReactNode[] {
  return flattenFragments(node).filter(isPinnedElement);
}

export function isOnlyPinnedHeaderActions(node: ReactNode): boolean {
  const children = flattenFragments(node);
  return children.length > 0 && children.every(isPinnedElement);
}
