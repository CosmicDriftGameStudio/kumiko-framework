// Temporal-Polyfill-Initialisierung.
//
// Hintergrund: Temporal ist seit Anfang 2026 in Chromium 144+ und Firefox 139+
// nativ verfügbar, aber nicht in Safari, iOS, oder Hermes (React Native).
// Bun/Node haben es teilweise (V8-abhängig, instabil).
//
// Damit kumiko-Apps universal laufen — Server (Bun), Web (alle Browser),
// Mobile (Hermes) — installiert das Framework beim Boot einmal den
// `temporal-polyfill` (FullCalendar, ~25 KB). Auf Runtimes mit nativem
// Temporal ist der Aufruf ein No-Op.
//
// Idempotent: mehrfacher Aufruf ist sicher (Polyfill prüft selbst ob
// `globalThis.Temporal` schon existiert). Wir cachen das Ergebnis trotzdem
// in einem Modul-Singleton, damit Boot-Performance nicht jedes Mal das
// Polyfill-Modul-Loading triggert.

let polyfillInstalled = false;
let polyfillPromise: Promise<void> | null = null;

/**
 * Stellt sicher dass `globalThis.Temporal` verfügbar ist. Idempotent.
 *
 * - Wenn Native Temporal existiert (moderne Browser, neueres Bun): No-Op.
 * - Sonst: lädt `temporal-polyfill/global` (installiert globalThis.Temporal).
 *
 * Wird einmal beim Framework-Boot aufgerufen. Feature-Code muss das nicht
 * selbst tun — `Temporal` ist nach dem Boot überall verfügbar.
 */
export async function ensureTemporalPolyfill(): Promise<void> {
  // skip: Idempotenz — Polyfill bereits installiert in einem früheren Aufruf.
  if (polyfillInstalled) return;
  if (polyfillPromise) {
    await polyfillPromise;
    // skip: Concurrent-Boot — anderer Aufruf hat die Installation übernommen.
    return;
  }

  polyfillPromise = (async () => {
    // biome-ignore lint/suspicious/noExplicitAny: globalThis.Temporal ist (noch) nicht typed
    if (typeof (globalThis as any).Temporal !== "undefined") {
      polyfillInstalled = true;
      // skip: Native Temporal vorhanden — Polyfill nicht nötig.
      return;
    }
    // Polyfill globally installieren — der Side-Effect-Import setzt
    // globalThis.Temporal.
    await import("temporal-polyfill/global");
    polyfillInstalled = true;
  })();

  await polyfillPromise;
}

/**
 * Type-safe Zugriff auf globalThis.Temporal. Wirft wenn der Polyfill noch
 * nicht installiert ist (Boot-Reihenfolge-Bug). Feature-Code sollte
 * `ensureTemporalPolyfill()` einmal awaiten und danach `Temporal` global
 * nutzen, oder über diesen Helper die Sicherheit haben.
 */
export function getTemporal(): typeof Temporal {
  // biome-ignore lint/suspicious/noExplicitAny: globalThis.Temporal ist (noch) nicht typed
  const T = (globalThis as any).Temporal as typeof Temporal | undefined;
  if (!T) {
    throw new Error(
      "Temporal not available. Call ensureTemporalPolyfill() during framework boot before any time-related code runs.",
    );
  }
  return T;
}
