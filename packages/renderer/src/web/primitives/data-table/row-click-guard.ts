import type { MouseEvent } from "react";

const INTERACTIVE_SELECTOR =
  "a[href], button, input, select, textarea, label, [role='button'], [role='link'], [role='switch'], [role='checkbox'], [role='menuitem'], [contenteditable='true']";

// React bubbles synthetic events through portals, so a click inside a drawer
// rendered from a custom cell reaches the row even though its DOM is elsewhere.
export function rowClickHandler(
  openRow: (() => void) | undefined,
): ((event: MouseEvent<HTMLElement>) => void) | undefined {
  if (openRow === undefined) return undefined;
  return (event) => {
    const { target, currentTarget } = event;
    if (!(target instanceof Element) || !currentTarget.contains(target)) return;
    const interactive = target.closest(INTERACTIVE_SELECTOR);
    if (
      interactive !== null &&
      interactive !== currentTarget &&
      currentTarget.contains(interactive)
    ) {
      return;
    }
    openRow();
  };
}
