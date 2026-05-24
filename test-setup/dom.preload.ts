// DOM-Polyfill für Tests die testing-library/react oder Radix-Komponenten
// nutzen. happy-dom global-registrator hängt window/document/HTMLElement
// in den globalThis. Reine Node-Tests sind davon nicht betroffen (kein
// Code-Pfad ändert sich für sie).

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach } from "bun:test";

// Idempotent registrieren — beim zweiten preload-Eintrag nicht crashen.
if (typeof globalThis.window === "undefined") {
  // Bun's native fetch/Request/Response/Headers vor happy-dom's
  // Überschreiben sichern. Happy-dom liefert eine eigene Request-
  // Implementierung deren headers.get("cookie") null zurückgibt —
  // das bricht Hono's getCookie() in jedem auth/csrf/sse-Test.
  // Wir wollen NUR die DOM-Globals (window, document, HTMLElement)
  // von happy-dom, NICHT die Fetch-API.
  const bunRequest = globalThis.Request;
  const bunResponse = globalThis.Response;
  const bunHeaders = globalThis.Headers;
  const bunFetch = globalThis.fetch;
  GlobalRegistrator.register();
  globalThis.Request = bunRequest;
  globalThis.Response = bunResponse;
  globalThis.Headers = bunHeaders;
  globalThis.fetch = bunFetch;
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

// Auto-Cleanup nach jedem Test (DOM-Pollution-Schutz):
// Bun-test läuft alle test-files in einem Process. Ohne afterEach hängen
// React-Komponenten von File N im document, File N+1 sieht polluted state.
// vitest hatte das via testing-library/react auto-magic. Bei bun: selbst
// registrieren — replaceChildren() statt innerHTML (XSS-safe).
afterEach(() => {
  if (typeof globalThis.document === "undefined") return;
  globalThis.document.body?.replaceChildren();
});
