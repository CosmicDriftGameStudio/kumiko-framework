import { Children, Fragment, isValidElement, type ReactNode, useContext } from "react";
import { HeaderOverflowMenuContext } from "./header-overflow-menu.ts";

/** Marks an app header action (e.g. the assistant trigger) that stays in the bar on a phone, next to the
 *  bell; the rest of `headerActions` folds into the "…" menu. Inside the menu it renders nothing. */
export function HeaderActionPinned({ children }: { readonly children: ReactNode }): ReactNode {
  const inMenu = useContext(HeaderOverflowMenuContext);
  return inMenu ? null : children;
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
