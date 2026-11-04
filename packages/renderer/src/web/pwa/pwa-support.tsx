import { type ReactNode, useEffect, useState } from "react";
import { PWA_SERVICE_WORKER_META_NAME } from "../../headless/pwa-service-worker-meta.ts";
import { useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";

export const PWA_INSTALL_HINT_DISMISSED_KEY = "kumiko:pwa-install-hint-dismissed";

// Chromium-only, so lib.dom does not declare it.
type BeforeInstallPromptEvent = Event & { readonly prompt: () => Promise<unknown> };

function isBeforeInstallPromptEvent(event: Event): event is BeforeInstallPromptEvent {
  return "prompt" in event && typeof event.prompt === "function";
}

type InstallHint =
  | { readonly kind: "none" }
  | { readonly kind: "ios" }
  | { readonly kind: "prompt"; readonly event: BeforeInstallPromptEvent };

export function readPwaServiceWorkerUrl(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const content = document
    .querySelector(`meta[name="${PWA_SERVICE_WORKER_META_NAME}"]`)
    ?.getAttribute("content");
  return content ? content : undefined;
}

function isRunningStandalone(): boolean {
  if (typeof window.matchMedia === "function") {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  }
  return "standalone" in navigator && navigator.standalone === true;
}

// iPadOS reports a desktop Mac user agent; the touch points tell it apart.
function isIosDevice(): boolean {
  const userAgent = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1;
}

// Storage can throw (Safari private mode, blocked site data); the hint then just shows again.
function isInstallHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(PWA_INSTALL_HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberInstallHintDismissed(): void {
  try {
    window.localStorage.setItem(PWA_INSTALL_HINT_DISMISSED_KEY, "1");
  } catch {
    // Not remembered: the hint comes back on the next visit.
  }
}

function registerServiceWorker(serviceWorkerUrl: string): void {
  if (!("serviceWorker" in navigator)) return;
  // Fails on insecure origins and in some private modes; the app works without the worker.
  // The worker may only control its own directory, so the scope follows the worker's URL.
  const scope = new URL("./", new URL(serviceWorkerUrl, window.location.href)).pathname;
  navigator.serviceWorker
    .register(serviceWorkerUrl, { scope, updateViaCache: "none" })
    .catch(() => undefined);
}

function useInstallHint(enabled: boolean): readonly [InstallHint, () => void] {
  const [hint, setHint] = useState<InstallHint>({ kind: "none" });

  useEffect(() => {
    if (!enabled || isRunningStandalone() || isInstallHintDismissed()) return;
    if (isIosDevice()) {
      setHint({ kind: "ios" });
      return;
    }
    const onBeforeInstallPrompt = (event: Event): void => {
      if (!isBeforeInstallPromptEvent(event)) return;
      // Keeps the browser's own mini-infobar away; the hint offers the prompt instead.
      event.preventDefault();
      setHint({ kind: "prompt", event });
    };
    const onAppInstalled = (): void => {
      rememberInstallHintDismissed();
      setHint({ kind: "none" });
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [enabled]);

  const dismiss = (): void => {
    rememberInstallHintDismissed();
    setHint({ kind: "none" });
  };
  return [hint, dismiss] as const;
}

const HINT_BUTTON_CLASSES = cn(
  "rounded-md px-3 py-1 text-xs font-medium",
  "hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring",
);

export function PwaSupport(): ReactNode {
  const t = useTranslation();
  const serviceWorkerUrl = readPwaServiceWorkerUrl();
  const [hint, dismiss] = useInstallHint(serviceWorkerUrl !== undefined);

  useEffect(() => {
    if (serviceWorkerUrl !== undefined) registerServiceWorker(serviceWorkerUrl);
  }, [serviceWorkerUrl]);

  if (hint.kind === "none") return null;

  const install = async (event: BeforeInstallPromptEvent): Promise<void> => {
    dismiss();
    try {
      await event.prompt();
    } catch {
      // prompt() rejects when the browser already used this event; nothing left to offer.
    }
  };

  return (
    <div
      role="status"
      className={cn(
        "fixed inset-x-0 bottom-0 z-[150] flex flex-wrap items-center justify-center gap-3",
        "border-t bg-background px-4 py-3 text-sm text-foreground shadow-md",
        "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
      )}
    >
      <span>
        {hint.kind === "ios" ? t("kumiko.pwa.install-hint-ios") : t("kumiko.pwa.install-hint")}
      </span>
      {hint.kind === "prompt" && (
        <button
          type="button"
          onClick={() => void install(hint.event)}
          className={cn(HINT_BUTTON_CLASSES, "bg-primary text-primary-foreground")}
        >
          {t("kumiko.pwa.install")}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        className={cn(HINT_BUTTON_CLASSES, "border bg-background")}
      >
        {t("kumiko.pwa.dismiss")}
      </button>
    </div>
  );
}
