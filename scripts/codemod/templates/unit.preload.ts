// Unit-Test preload — Template pro Repo anpassen.
//
// Ersetzt vitest.setup.ts. Wird via bunfig.toml [test].preload geladen,
// einmal pro Test-File vor allen Test-Statements.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// happy-dom als DOM-Polyfill registrieren. Tests die DOM brauchen
// (testing-library/react, Radix-Components) bekommen window, document,
// HTMLElement etc. global. Node-only-Tests sind davon nicht betroffen
// (die typeof-Checks unten greifen nur wenn DOM da ist).
GlobalRegistrator.register();

// Temporal-Polyfill — Tests die ctx.tz oder direkt Temporal.* nutzen.
// In Production-Boot-Pfaden via ensureTemporalPolyfill(); für reine
// Unit-Tests (kein setupTestStack) wird der Bootstrap hier gemacht.
// PFAD ANPASSEN pro Repo:
import { ensureTemporalPolyfill } from "../packages/framework/src/time/polyfill";
await ensureTemporalPolyfill();

// jsdom/happy-dom-Polyfill: Pointer-Capture-APIs fehlen.
// Radix-UI nutzt sie auf Triggers von DropdownMenu/Select/Popover —
// ohne Polyfill schluckt das Open-Handling stillschweigend und der
// Dropdown öffnet sich nicht im Test. typeof-Check, weil reine
// node-only Tests kein HTMLElement haben (Dispatcher-Tests, Engine-Tests).
if (typeof globalThis.HTMLElement !== "undefined") {
  const proto = globalThis.HTMLElement.prototype as unknown as Record<string, unknown>;
  if (proto.hasPointerCapture === undefined) {
    proto.hasPointerCapture = (): boolean => false;
  }
  if (proto.setPointerCapture === undefined) {
    proto.setPointerCapture = (): void => undefined;
  }
  if (proto.releasePointerCapture === undefined) {
    proto.releasePointerCapture = (): void => undefined;
  }
  if (proto.scrollIntoView === undefined) {
    proto.scrollIntoView = (): void => undefined;
  }
}
