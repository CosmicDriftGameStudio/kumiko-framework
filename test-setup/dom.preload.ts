// DOM-Polyfill für Tests die testing-library/react oder Radix-Komponenten
// nutzen. happy-dom global-registrator hängt window/document/HTMLElement
// in den globalThis. Reine Node-Tests sind davon nicht betroffen (kein
// Code-Pfad ändert sich für sie).

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach } from "bun:test";

// react-dom prüft IS_REACT_ACT_ENVIRONMENT um act()-Warnungen zu
// unterdrücken. vitest setzte das via @testing-library/react auto-magic;
// bei bun:test setzen wir es explizit.
// @ts-expect-error — React-Typing kennt das Property nicht auf globalThis
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

// @testing-library/dom/dist/screen.js prüft document.body beim
// Modul-Import. Mit static import würde screen vor happy-dom
// evaluieren → alle screen-Queries werfen TypeError. Deshalb
// require() erst nach der Registration oben.
const { cleanup } = require("@testing-library/react/pure") as {
  cleanup: () => void;
};

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
// React-Komponenten von File N im DOM von File N+1.
//
// VIER Leak-Quellen:
//
//   a) testing-library/react-Container — cleanup() unmountet + entfernt
//      alle von render() erzeugten Container-Knoten.
//
//   b) body.replaceChildren() — räumt Container die nicht über
//      testing-library/react erzeugt wurden (z.B. `#root` via
//      ReactDOM.createRoot + renderShell). Muss NACH cleanup()
//      kommen — React braucht seine Knoten zum unmount.
//
//   c) Radix DismissableLayer setzt body.style.pointerEvents='none'
//      beim Öffnen von Dialog/Popover/Dropdown.
//
//   d) Radix-injizierte style-tags im head.
//
//   e) window.location / history.pushState.
afterEach(() => {
  if (typeof globalThis.document === "undefined") return;

  // (a) React-Cleanup zuerst — unmountet alle testing-library-gerenderten
  //     Komponenten via ReactDOM.unmountComponentAtNode. Das muss vor
  //     jeder DOM-Manipulation passieren weil React seine Knoten braucht.
  cleanup();

  const doc = globalThis.document;
  if (!doc.body) return;

  // (b) Übrige Knoten werden nicht aktiv entfernt — cleanup() aus
  //     testing-library/react räumt alle render()-Container. Nicht-
  //     standard Container (#root via createRoot) müssen die Tests
  //     selbst cleanen oder via afterEach im Test-File. body.replace-
  //     Children() triggert asynchrone React-Effects ohne act-Kontext.

  // (c) Radix-Leak: body inline-style reset
  doc.body.style.pointerEvents = "";

  // (d) Radix-injizierte style-tags
  for (const el of doc.head.querySelectorAll("style")) {
    const style = el as HTMLStyleElement;
    if (style.id?.startsWith("radix-")) {
      style.remove();
    }
  }

  // (e) window.location zurücksetzen — happy-dom initial url.
  // replaceState statt pushState — sonst akkumuliert über alle Tests
  // ein History-Stack mit 3000+ Einträgen (Memory-Leak + bricht Tests
  // die history.length checken).
  if (typeof globalThis.history !== "undefined") {
    globalThis.history.replaceState(null, "", "http://localhost/");
  }
});
