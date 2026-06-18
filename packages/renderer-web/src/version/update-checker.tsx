// Update-Awareness — default an, kein Flag. Ein offener Tab erfährt sonst
// nie von einem neuen Deploy (SPA bleibt geladen, index.html wird nicht neu
// geholt → "muss hart reloaden"). Statt Service-Worker (der ist die *Ursache*
// von "hängt auf alter Version") pollt diese Komponente die statische
// build-info.json beim Tab-Fokus und zeigt ein Reload-Banner bei Drift.
//
// Versionsquelle ist build-info.json (Hash über die Asset-URLs, vom Prod-Build
// geschrieben) — NICHT /api/version (live leer/404, Env-/Dockerfile-Falle).
// Banner-Strings über kumikoDefaultTranslations (kumiko.version.*, de/en).

import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/cn";

// Build-Stand, der beim Page-Load aktiv war. Vom Prod-Build in die index.html
// gebacken (build-prod-bundle injectAssetTags). Fehlt im Dev und in alten
// Bundles → der Checker macht dann nichts (fail-safe).
type KumikoBuild = {
  readonly id: string;
  readonly builtAt: string;
};

declare global {
  interface Window {
    __KUMIKO_BUILD__?: KumikoBuild;
  }
}

// Korrektheitsgrenze der Update-Erkennung: ein Banner NUR bei echtem
// ID-Drift. Kein geladener Stand (Dev/altes Bundle) oder kein Server-Stand
// (Fetch-Fehler/kaputtes JSON → null) → nie ein Fake-Banner.
export function shouldShowUpdate(
  loadedId: string | undefined,
  server: KumikoBuild | null,
): boolean {
  if (!loadedId || !server) return false;
  return server.id !== loadedId;
}

async function fetchServerBuild(): Promise<KumikoBuild | null> {
  try {
    const res = await fetch("/build-info.json", { cache: "no-store" });
    if (!res.ok) return null;
    const info = (await res.json()) as Partial<KumikoBuild>;
    if (typeof info.id !== "string" || info.id.length === 0) return null;
    return { id: info.id, builtAt: typeof info.builtAt === "string" ? info.builtAt : "" };
  } catch {
    // Netzwerkfehler / kaputtes JSON → kein Banner. Nie ein Fake-Update zeigen.
    return null;
  }
}

export function UpdateChecker(): ReactNode {
  const t = useTranslation();
  const loaded = typeof window !== "undefined" ? window.__KUMIKO_BUILD__ : undefined;
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    const loadedId = loaded?.id;
    if (!loadedId) return; // Dev / altes Bundle → keine Awareness.

    let cancelled = false;
    const check = async (): Promise<void> => {
      if (document.visibilityState !== "visible") return;
      const server = await fetchServerBuild();
      if (!cancelled && shouldShowUpdate(loadedId, server)) setHasUpdate(true);
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
