//
// Pins the XSS-escaping behavior for tenant-/pattern-authored content
// (kumiko-framework#1321). renderer-web has no dangerouslySetInnerHTML
// and no field-renderer path that wires tenant data into href/src — this
// test guards JSX auto-escaping against future regressions (e.g. if
// someone adds rich-text/markdown support via dangerouslySetInnerHTML),
// and pins the Link primitive's scheme guard (kumiko-framework#1365)
// against javascript:/data: hrefs as defense-in-depth.

import { describe, expect, test } from "bun:test";
import { defaultPrimitives } from "../primitives";
import { StatCard } from "../widgets/stat";
import { render, screen } from "./test-utils";

const PAYLOAD = '<script>window.__xss = true;</script><img src=x onerror="window.__xss = true">';
const UNSAFE_HREFS = [
  "javascript:window.__xss = true",
  "data:text/html,<script>window.__xss=true</script>",
];

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

  test.each(UNSAFE_HREFS)("Link-Primitive neutralisiert unsicheren href-Scheme: %s", (href) => {
    render(
      <defaultPrimitives.Link testId="link" href={href}>
        text
      </defaultPrimitives.Link>,
    );
    const node = screen.getByTestId("link");
    expect(node.getAttribute("href")).toBe("#");
  });

  test("Link-Primitive lässt sichere hrefs (https/mailto/relativ) unverändert", () => {
    for (const href of ["https://example.com", "mailto:a@example.com", "/relative/path"]) {
      render(
        <defaultPrimitives.Link testId={`link-${href}`} href={href}>
          text
        </defaultPrimitives.Link>,
      );
      expect(screen.getByTestId(`link-${href}`).getAttribute("href")).toBe(href);
    }
  });
});
