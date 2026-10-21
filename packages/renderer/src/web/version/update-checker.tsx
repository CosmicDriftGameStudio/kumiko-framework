// Update awareness is enabled by default, without a flag. Otherwise, an open tab
// never learns about a new deploy because the SPA stays loaded and does not fetch
// index.html again, so it requires a hard reload. Instead of a service worker—which
// causes the “stuck on old version” problem—this component polls the static
// build-info.json when the tab gains focus and shows a reload banner on drift.
//
// The version source is build-info.json (a hash of the asset URLs written by the
// production build), not /api/version (which may be empty or 404 at runtime because
// of environment or Dockerfile configuration). Banner strings come from
// kumikoDefaultTranslations (kumiko.version.*, de/en).

import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";

// Build that was active at page load, baked into index.html by the prod build
// as <meta name="kumiko-build"> (build-prod-bundle injectAssetTags). Missing in
// dev and in old bundles, and then the checker does nothing (fail-safe).
export type KumikoBuild = {
  readonly id: string;
  readonly builtAt: string;
};

export function readLoadedBuild(): KumikoBuild | undefined {
  if (typeof document === "undefined") return undefined;
  const meta = document.querySelector('meta[name="kumiko-build"]');
  const id = meta?.getAttribute("content");
  if (!id) return undefined;
  return { id, builtAt: meta?.getAttribute("data-built-at") ?? "" };
}

// Update detection is only valid for a real ID drift: a banner is shown only then.
// No loaded build (development or an old bundle), or no server build (fetch failure
// or invalid JSON → null), must never produce a false update banner.
export function shouldShowUpdate(
  loadedId: string | undefined,
  server: KumikoBuild | null,
): boolean {
  if (!loadedId || !server) return false;
  return server.id !== loadedId;
}

export function isKumikoBuild(v: unknown): v is Pick<KumikoBuild, "id"> {
  return (
    typeof v === "object" && v !== null && "id" in v && typeof v.id === "string" && v.id !== ""
  );
}

async function fetchServerBuild(): Promise<KumikoBuild | null> {
  try {
    const res = await fetch("/build-info.json", { cache: "no-store" });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    if (!isKumikoBuild(raw)) return null;
    const builtAt = propertyOf(raw, "builtAt");
    return { id: raw.id, builtAt: typeof builtAt === "string" ? builtAt : "" };
  } catch {
    // Network failure or invalid JSON → no banner; never show a false update.
    return null;
  }
}

export function UpdateChecker(): ReactNode {
  const t = useTranslation();
  const loaded = readLoadedBuild();
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    const loadedId = loaded?.id;
    if (!loadedId) return; // Development or an old bundle → no update awareness.

    let cancelled = false;
    const checking = { current: false };
    const check = async (): Promise<void> => {
      if (document.visibilityState !== "visible") return;
      if (checking.current) return; // visibilitychange + focus fire together on tab-return
      checking.current = true;
      try {
        const server = await fetchServerBuild();
        if (!cancelled && shouldShowUpdate(loadedId, server)) setHasUpdate(true);
      } finally {
        checking.current = false;
      }
    };

    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    void check();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [loaded?.id]);

  if (!hasUpdate) return null;

  return (
    <div
      role="status"
      className={cn(
        "fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-3",
        "border-b bg-background px-4 py-2 text-sm text-foreground shadow-md",
      )}
    >
      <span>{t("kumiko.version.update-available")}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className={cn(
          "rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground",
          "hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring",
        )}
      >
        {t("kumiko.actions.reload")}
      </button>
    </div>
  );
}
