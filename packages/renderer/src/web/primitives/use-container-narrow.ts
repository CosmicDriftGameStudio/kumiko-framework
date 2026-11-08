import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { NARROW_VIEWPORT_BREAKPOINT_PX } from "./use-narrow-viewport.ts";

// Set by the shell while the assistant panel is docked; the inset then gets that much right padding.
const DOCKED_PANEL_WIDTH_VAR = "--agent-panel-width";

function isPanelDocked(element: HTMLElement): boolean {
  const width = Number.parseFloat(
    getComputedStyle(element).getPropertyValue(DOCKED_PANEL_WIDTH_VAR),
  );
  return Number.isFinite(width) && width > 0;
}

/** `narrow`: the referenced element is narrower than the card breakpoint. `docked`: the shell
 *  reports a docked assistant panel, which shrinks the content without changing the viewport (so
 *  a media query cannot see it) and not necessarily below the breakpoint. Both are false until
 *  measured and where ResizeObserver is missing. */
export function useContainerSqueeze<T extends HTMLElement>(): [
  RefObject<T | null>,
  { readonly narrow: boolean; readonly docked: boolean },
] {
  const ref = useRef<T | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [docked, setDocked] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    // skip: no element or no observer support (SSR, bare test DOMs) keeps the viewport rules
    if (element === null || typeof ResizeObserver === "undefined") return;
    const measure = (): void => {
      const width = element.getBoundingClientRect().width;
      setNarrow(width > 0 && width < NARROW_VIEWPORT_BREAKPOINT_PX);
      setDocked(isPanelDocked(element));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // An overflowing table keeps its width when the panel docks, so only the variable change tells.
    const styleObserver = new MutationObserver(measure);
    styleObserver.observe(element.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => {
      observer.disconnect();
      styleObserver.disconnect();
    };
  }, []);
  return [ref, { narrow, docked }];
}
