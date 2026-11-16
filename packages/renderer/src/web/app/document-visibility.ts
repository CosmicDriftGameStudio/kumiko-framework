import type { PageVisibilityState } from "../../context/page-visibility-context.tsx";
import type { Store } from "../../headless/index.ts";

export function createDocumentVisibilityStore(): Store<PageVisibilityState> {
  return {
    getSnapshot: () =>
      typeof document !== "undefined" && document.visibilityState === "hidden"
        ? "hidden"
        : "visible",
    subscribe: (listener) => {
      if (typeof document === "undefined") return () => {};
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}
