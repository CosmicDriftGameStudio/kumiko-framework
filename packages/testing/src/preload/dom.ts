// DOM polyfill for tests that use testing-library/react or Radix components.
// happy-dom's global-registrator attaches window/document/HTMLElement to
// globalThis. Plain Node tests are unaffected, no code path changes for them.

import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

declare global {
  // React's own typings don't declare this property on globalThis.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// react-dom checks IS_REACT_ACT_ENVIRONMENT to suppress act() warnings.
// vitest set this automatically via @testing-library/react; with bun:test we
// set it explicitly.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Register idempotently, so a second preload entry doesn't crash.
if (typeof globalThis.window === "undefined") {
  // Preserve Bun's native fetch/Request/Response/Headers before happy-dom
  // overwrites them. happy-dom ships its own Request implementation whose
  // headers.get("cookie") returns null, which breaks Hono's getCookie() in
  // every auth/csrf/sse test. We only want the DOM globals (window,
  // document, HTMLElement) from happy-dom, not the fetch API.
  const bunRequest = globalThis.Request;
  const bunResponse = globalThis.Response;
  const bunHeaders = globalThis.Headers;
  const bunFetch = globalThis.fetch;
  const bunAbortController = globalThis.AbortController;
  const bunAbortSignal = globalThis.AbortSignal;
  const bunWritableStream = globalThis.WritableStream;
  const bunTransformStream = globalThis.TransformStream;
  // The url option sets window.location to http://localhost/. Without it
  // happy-dom defaults to about:blank, so history.pushState/replaceState
  // doesn't work (invalid origin) and window.location.pathname stays
  // "blank", breaking every router/nav test.
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

// @testing-library/dom/dist/screen.js checks document.body at module import
// time. A static import would evaluate screen before happy-dom registers, so
// every screen query would throw TypeError. Hence require() only after the
// registration above.
const { cleanup } = require("@testing-library/react/pure") as {
  cleanup: () => void;
};

const HTML_PRINT_LIMIT = 2000;

// Pointer-capture APIs are missing in happy-dom, same as in jsdom. Radix-UI
// (DropdownMenu/Select/Popover triggers) calls them, so nothing opens in
// tests without the polyfill.
if (typeof globalThis.HTMLElement !== "undefined") {
  const proto = globalThis.HTMLElement.prototype as unknown as Record<string | symbol, unknown>;
  if (proto["hasPointerCapture"] === undefined) proto["hasPointerCapture"] = () => false;
  if (proto["setPointerCapture"] === undefined) proto["setPointerCapture"] = () => undefined;
  if (proto["releasePointerCapture"] === undefined)
    proto["releasePointerCapture"] = () => undefined;
  if (proto["scrollIntoView"] === undefined) proto["scrollIntoView"] = () => undefined;

  // Without this, printing a happy-dom node walks its whole object graph:
  // ownerDocument plus every React fiber property, which is 15 MB of string
  // for a two-element tree and 0.5-1.7 s per call. A failed assertion inside
  // waitFor pays that on every poll and blocks the loop long enough to starve
  // React's commit and waitFor's own timeout (#3082).
  const inspect = Symbol.for("nodejs.util.inspect.custom");
  if (proto[inspect] === undefined) {
    proto[inspect] = function (this: HTMLElement): string {
      const html = this.outerHTML;
      return html.length > HTML_PRINT_LIMIT ? `${html.slice(0, HTML_PRINT_LIMIT)}…` : html;
    };
  }
}

// Auto-cleanup after every test (DOM pollution guard): bun test runs all
// test files in one process, so without afterEach, React components from
// file N stay mounted in file N+1's DOM.
//
// FIVE leak sources:
//
//   a) testing-library/react container: cleanup() unmounts and removes
//      every container node render() created.
//
//   b) body.replaceChildren(): clears containers not created via
//      testing-library/react (e.g. #root via ReactDOM.createRoot +
//      renderShell). Must run after cleanup(), since React needs its nodes
//      to unmount.
//
//   c) Radix DismissableLayer sets body.style.pointerEvents='none' when
//      opening a Dialog/Popover/Dropdown.
//
//   d) Radix-injected style tags in head.
//
//   e) window.location / history.pushState.
afterEach(() => {
  if (typeof globalThis.document === "undefined") return;

  // (a) React cleanup first: unmounts every testing-library-rendered
  //     component via ReactDOM.unmountComponentAtNode. Must happen before
  //     any DOM manipulation because React needs its nodes.
  cleanup();

  const doc = globalThis.document;
  if (!doc.body) return;

  // (b) Remaining nodes are not actively removed: cleanup() from
  //     testing-library/react clears all render() containers. Non-standard
  //     containers (#root via createRoot) must be cleaned by the tests
  //     themselves or via afterEach in the test file. body.replaceChildren()
  //     triggers async React effects without an act context.

  // (c) Radix leak: reset the body inline style
  doc.body.style.pointerEvents = "";

  // (d) Radix-injected style tags
  for (const el of doc.head.querySelectorAll("style")) {
    const style = el as HTMLStyleElement;
    if (style.id?.startsWith("radix-")) {
      style.remove();
    }
  }

  // (e) Reset window.location to happy-dom's initial url. replaceState
  // instead of pushState, otherwise a history stack of 3000+ entries
  // accumulates across all tests (memory leak, plus it breaks tests that
  // check history.length).
  if (typeof globalThis.history !== "undefined") {
    globalThis.history.replaceState(null, "", "http://localhost/");
  }
});
