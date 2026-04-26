// Globaler Vitest-Setup: Temporal-Polyfill bevor irgendein Test-Code läuft.
//
// Jeder Test der `ctx.tz` (oder direkt `Temporal.*`) verwendet braucht den
// Polyfill — ohne wäre globalThis.Temporal undefined und Test-Code würde
// mit "Temporal not available" werfen.
//
// In den Production-Boot-Pfaden (setupTestStack, server-bootstrap) wird der
// Polyfill explizit per ensureTemporalPolyfill() installiert. Für reine Unit-
// Tests (die nicht durch setupTestStack laufen) brauchen wir diesen
// Bootstrap-File.

import { ensureTemporalPolyfill } from "./packages/framework/src/time/polyfill";

await ensureTemporalPolyfill();

// jsdom-Polyfill: Pointer-Capture-APIs fehlen (https://github.com/jsdom/jsdom/issues/2527).
// Radix-UI nutzt sie auf den Triggers von DropdownMenu/Select/Popover — ohne
// Polyfill schluckt das Open-Handling stillschweigend und der Dropdown öffnet
// sich nicht im Test. typeof-Check, weil reine node-Tests kein HTMLElement
// haben (Dispatcher-Tests, Engine-Tests).
if (typeof globalThis.HTMLElement !== "undefined") {
  const proto = globalThis.HTMLElement.prototype as unknown as Record<string, unknown>;
  if (proto.hasPointerCapture === undefined) proto.hasPointerCapture = (): boolean => false;
  if (proto.setPointerCapture === undefined) proto.setPointerCapture = (): void => undefined;
  if (proto.releasePointerCapture === undefined)
    proto.releasePointerCapture = (): void => undefined;
  if (proto.scrollIntoView === undefined) proto.scrollIntoView = (): void => undefined;
}
