//
// Pinnt das XSS-Escaping-Verhalten für tenant-/pattern-authored Content
// (kumiko-framework#1321). renderer-web hat kein dangerouslySetInnerHTML
// und keine href/src-Pipeline für tenant-Daten — dieser Test sichert das
// JSX-Auto-Escaping gegen künftige Regressionen ab (z.B. falls jemand
// Rich-Text/Markdown-Support via dangerouslySetInnerHTML nachrüstet).

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
