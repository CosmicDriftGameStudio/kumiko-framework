import { type ReactNode, useSyncExternalStore } from "react";
import { useDispatcherStatus, useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";

function subscribeBrowserNetwork(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function useBrowserOffline(): boolean {
  return useSyncExternalStore(
    subscribeBrowserNetwork,
    () => typeof navigator !== "undefined" && navigator.onLine === false,
    () => false,
  );
}

export function OfflineBanner(): ReactNode {
  const t = useTranslation();
  const dispatcherStatus = useDispatcherStatus();
  const browserOffline = useBrowserOffline();
  const offline = dispatcherStatus === "offline" || browserOffline;
  // The container stays mounted so screen readers announce the change.
  return (
    <div role="status" aria-live="polite">
      {offline && (
        <div
          className={cn(
            "fixed inset-x-0 top-0 z-[200] flex items-center justify-center",
            "border-b bg-background px-4 py-2 text-sm text-foreground shadow-md",
          )}
        >
          {t("kumiko.network.offline")}
        </div>
      )}
    </div>
  );
}
