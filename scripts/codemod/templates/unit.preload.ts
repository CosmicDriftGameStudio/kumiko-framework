// Unit-test preload — adapt template per repo.
//
// Replaces vitest.setup.ts. Loaded via bunfig.toml [test].preload,
// once per test file before all test statements.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Register happy-dom as a DOM polyfill. Tests that need the DOM
// (testing-library/react, Radix-Components) get window, document,
// HTMLElement etc. globally. Node-only tests are unaffected
// (the typeof checks below only apply when the DOM is present).
GlobalRegistrator.register();

// Temporal polyfill — tests that use ctx.tz or directly Temporal.*.
// In production boot paths via ensureTemporalPolyfill(); for pure
// unit tests (no setupTestStack), bootstrap here.
// ADJUST PATH per repo:
import { ensureTemporalPolyfill } from "../packages/framework/src/time/polyfill";
await ensureTemporalPolyfill();

// jsdom/happy-dom polyfill: Pointer-Capture APIs are missing.
// Radix-UI uses them on triggers of DropdownMenu/Select/Popover —
// without the polyfill, open handling silently fails and the
// dropdown does not open in the test. typeof check because pure
// node-only tests have no HTMLElement (Dispatcher tests, Engine tests).
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
