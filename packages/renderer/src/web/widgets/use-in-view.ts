import { useCallback, useState } from "react";

/** True once the element has come near the viewport; stays true afterwards. Without IntersectionObserver everything counts as visible. */
export function useSeenInViewport(rootMargin = "300px 0px"): {
  readonly seen: boolean;
  readonly observe: (element: Element | null) => (() => void) | undefined;
} {
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  const observe = useCallback(
    (element: Element | null) => {
      if (element === null || typeof IntersectionObserver === "undefined") return undefined;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setSeen(true);
            observer.disconnect();
          }
        },
        { rootMargin },
      );
      observer.observe(element);
      return () => observer.disconnect();
    },
    [rootMargin],
  );
  return { seen, observe };
}
