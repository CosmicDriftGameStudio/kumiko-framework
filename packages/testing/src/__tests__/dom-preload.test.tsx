import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";

// This file only runs under bunfig.dom.toml (bun run test:dom), which
// preloads @cosmicdrift/kumiko-testing/preload/dom. It exists to prove that
// preload actually registers happy-dom and wires testing-library cleanup —
// bunfig.test.ts only checks the generated config string, not that loading
// it produces a working DOM.
describe("preload/dom", () => {
  test("happy-dom globals are registered", () => {
    expect(typeof window).toBe("object");
    expect(typeof document).toBe("object");
    expect(globalThis.IS_REACT_ACT_ENVIRONMENT).toBe(true);
  });

  test("testing-library/react can render into the registered DOM", () => {
    render(<button type="button">preload works</button>);
    expect(screen.getByRole("button", { name: "preload works" })).toBeTruthy();
  });

  test("Request stays Bun's native implementation, not happy-dom's", () => {
    // happy-dom's own Request implementation returns null for
    // headers.get("cookie") regardless of what was set — the exact bug the
    // preload works around by restoring Bun's native Request after
    // registration.
    const request = new Request("http://localhost/", { headers: { cookie: "session=abc" } });
    expect(request.headers.get("cookie")).toBe("session=abc");
  });
});
