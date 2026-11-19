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
        // In the page flow above the shell; styles.css shrinks the viewport-fit shells by
        // --kumiko-offline-banner-height. Fixed height so portals resolve it in CSS alone.
        <div
          data-kumiko-offline-banner=""
          className={cn(
            "flex h-(--kumiko-offline-banner-height) items-center justify-center overflow-hidden",
            "border-b bg-background px-4 text-center text-xs leading-4 text-foreground sm:text-sm",
          )}
        >
          {t("kumiko.network.offline")}
        </div>
      )}
    </div>
  );
}
