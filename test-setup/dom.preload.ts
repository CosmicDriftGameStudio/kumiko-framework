// DOM-Polyfill für Tests die testing-library/react oder Radix-Komponenten
// nutzen. happy-dom global-registrator hängt window/document/HTMLElement
// in den globalThis. Reine Node-Tests sind davon nicht betroffen (kein
// Code-Pfad ändert sich für sie).

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Idempotent registrieren — beim zweiten preload-Eintrag nicht crashen.
if (typeof globalThis.window === "undefined") {
  GlobalRegistrator.register();
}

// Pointer-Capture-APIs fehlen in happy-dom genauso wie in jsdom. Radix-UI
// (DropdownMenu/Select/Popover-Triggers) ruft die — ohne Polyfill öffnet
// sich nichts im Test.
if (typeof globalThis.HTMLElement !== "undefined") {
  const proto = globalThis.HTMLElement.prototype as unknown as Record<string, unknown>;
  if (proto.hasPointerCapture === undefined) proto.hasPointerCapture = () => false;
  if (proto.setPointerCapture === undefined) proto.setPointerCapture = () => undefined;
  if (proto.releasePointerCapture === undefined) proto.releasePointerCapture = () => undefined;
  if (proto.scrollIntoView === undefined) proto.scrollIntoView = () => undefined;
}
