//
// Pins the XSS-escaping behavior for tenant-/pattern-authored content
// (kumiko-framework#1321). renderer-web has no dangerouslySetInnerHTML
// and no href/src pipeline for tenant data — this test guards JSX
// auto-escaping against future regressions (e.g. if someone adds
// rich-text/markdown support via dangerouslySetInnerHTML).

import { describe, expect, test } from "bun:test";
import { defaultPrimitives } from "../primitives";
import { StatCard } from "../widgets/stat";
import { render, screen } from "./test-utils";

const PAYLOAD = '<script>window.__xss = true;</script><img src=x onerror="window.__xss = true">';

describe("XSS-safety (tenant-authored content)", () => {
  test("Text-Primitive rendert Payload als Text, nicht als HTML", () => {
    render(<defaultPrimitives.Text testId="txt">{PAYLOAD}</defaultPrimitives.Text>);
    const node = screen.getByTestId("txt");
    expect(node.textContent).toBe(PAYLOAD);
    expect(node.querySelector("script")).toBeNull();
    expect(node.querySelector("img")).toBeNull();
  });

  test("StatCard-Widget rendert label/value/sub als Text, nicht als HTML", () => {
    render(<StatCard testId="stat" label={PAYLOAD} value={PAYLOAD} sub={PAYLOAD} />);
    const node = screen.getByTestId("stat");
    expect(node.querySelector("script")).toBeNull();
    expect(node.querySelector("img")).toBeNull();
    expect(node.textContent).toContain(PAYLOAD);
  });
});
