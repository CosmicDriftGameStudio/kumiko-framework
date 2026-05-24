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
  const bunAbortController = globalThis.AbortController;
  const bunAbortSignal = globalThis.AbortSignal;
  const bunWritableStream = globalThis.WritableStream;
  const bunTransformStream = globalThis.TransformStream;
  // url-Option setzt window.location auf http://localhost/. Ohne hat
  // happy-dom about:blank als Default — history.pushState/replaceState
  // greift dann nicht (invalid origin) and window.location.pathname
  // bleibt "blank". Bricht alle Router/Nav-Tests.
  GlobalRegistrator.register({ url: "http://localhost/" });
  globalThis.Request = bunRequest;
  globalThis.Response = bunResponse;
  globalThis.Headers = bunHeaders;
  globalThis.fetch = bunFetch;
  globalThis.AbortController = bunAbortController;
  globalThis.AbortSignal = bunAbortSignal;
  globalThis.WritableStream = bunWritableStream;
  globalThis.TransformStream = bunTransformStream;
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
// registrieren.
//
// Zwei Pollution-Quellen:
//   a) DOM-Knoten von React (replaceChildren)
//   b) Radix DismissableLayer setzt body.style.pointerEvents='none'
//      beim Öffnen von Dialog/Popover/Dropdown. Wenn afterEach DOM
//      vor Reacts useEffect-Cleanup zerstört, bleibt pointer-events
//      auf body hängen — alle userEvent.click() im nächsten Test
//      schlagen feil mit "pointer-events: none".
//   c) style-Tags im head (Radix, Emotion, etc.) — per
//      querySelectorAll entfernen.
afterEach(() => {
  if (typeof globalThis.document === "undefined") return;
  const doc = globalThis.document;
  // (b) Radix-Leak: body inline-style reset
  if (doc.body) {
    doc.body.style.pointerEvents = "";
    doc.body.replaceChildren();
  }
  // (c) Injected style-tags entfernen (Radix-/CSS-in-JS-Leaks)
  for (const el of doc.head.querySelectorAll("style,link[rel=stylesheet]")) {
    const style = el as HTMLStyleElement | HTMLLinkElement;
    if (style.id?.startsWith("radix-") || style.dataset?.radium) {
      style.remove();
    }
  }
});
