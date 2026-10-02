import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";

// This file only runs under bunfig.dom.toml (bun run test:dom), which
// preloads @cosmicdrift/kumiko-testing/preload/dom. It exists to prove the
// preload actually registers happy-dom and wires testing-library cleanup,
// since bunfig.test.ts only checks the generated config string, not that
// loading it produces a working DOM.
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

  // Printing a happy-dom node used to walk ownerDocument plus every React fiber
  // (15 MB for a two-element tree). Bounded output means the inspect hook is
  // still honoured by this Bun + happy-dom combination.
  const MAX_PRINTED_NODE_LENGTH = 2100;

  test("printing a rendered HTML element stays bounded", () => {
    const { container } = render(
      <div>
        <span>hello</span>
      </div>,
    );
    const printed = Bun.inspect(container);
    expect(printed.length).toBeLessThan(MAX_PRINTED_NODE_LENGTH);
    expect(printed).toContain("hello");
  });

  test("printing a large HTML tree is truncated, not dumped", () => {
    const { container } = render(
      <ul>
        {Array.from({ length: 500 }, (_, index) => (
          <li key={index}>item {index}</li>
        ))}
      </ul>,
    );
    expect(container.outerHTML.length).toBeGreaterThan(MAX_PRINTED_NODE_LENGTH);
    expect(Bun.inspect(container).length).toBeLessThan(MAX_PRINTED_NODE_LENGTH);
  });

  test("printing an SVG element stays bounded too", () => {
    const { container } = render(
      <svg role="img" aria-label="icon">
        <title>icon</title>
        <circle cx="5" cy="5" r="4" />
      </svg>,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(Bun.inspect(svg).length).toBeLessThan(MAX_PRINTED_NODE_LENGTH);
  });

  test("Request stays Bun's native implementation, not happy-dom's", () => {
    // happy-dom's own Request implementation returns null for
    // headers.get("cookie") regardless of what was set, the exact bug the
    // preload works around by restoring Bun's native Request after
    // registration.
    const request = new Request("http://localhost/", { headers: { cookie: "session=abc" } });
    expect(request.headers.get("cookie")).toBe("session=abc");
  });
});
