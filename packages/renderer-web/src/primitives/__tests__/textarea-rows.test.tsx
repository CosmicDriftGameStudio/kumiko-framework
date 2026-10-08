// #2677 — `field-sizing: content` on the vendored shadcn Textarea makes the
// `rows` attribute inert, so a declared row count has to reach the rendered
// height as a min-height floor. Asserting the attribute alone would pass even
// with the bug present.
import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { defaultPrimitives } from "../index.js";

const { Input } = defaultPrimitives;
const noop = () => {};

function renderTextarea(rows?: number): HTMLTextAreaElement {
  const { container } = render(
    <Input
      kind="textarea"
      id="notes"
      name="notes"
      value=""
      onChange={noop}
      {...(rows !== undefined && { rows })}
    />,
  );
  const textarea = container.querySelector("textarea");
  if (textarea === null) throw new Error("no textarea rendered");
  return textarea;
}

function rowFactor(minHeight: string): number {
  const match = /calc\((\d+(?:\.\d+)?) \* 1lh/.exec(minHeight);
  if (match?.[1] === undefined) throw new Error(`min-height not row-derived: "${minHeight}"`);
  return Number(match[1]);
}

describe("textarea rows → min-height (#2677)", () => {
  test("declared rows drive the min-height, not just the attribute", () => {
    const textarea = renderTextarea(16);
    expect(textarea.getAttribute("rows")).toBe("16");
    expect(rowFactor(textarea.style.minHeight)).toBe(16);
  });

  test("min-height scales with the declared row count", () => {
    const small = rowFactor(renderTextarea(4).style.minHeight);
    const large = rowFactor(renderTextarea(16).style.minHeight);
    expect(large).toBeGreaterThan(small);
  });

  test("without rows no min-height is imposed — the Tailwind floor stays", () => {
    expect(renderTextarea().style.minHeight).toBe("");
  });

  // textareaMinHeight hardcodes the vendored frame (py-2 + 1px border); a
  // shadcn re-sync that changes either must fail here instead of drifting silently.
  test("vendored textarea still carries the frame classes the min-height addend assumes", () => {
    const classes = renderTextarea(4).className.split(/\s+/);
    expect(classes).toContain("py-2");
    expect(classes).toContain("border");
  });
});
