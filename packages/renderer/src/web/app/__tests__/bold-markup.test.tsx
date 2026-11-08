import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderBoldMarkup } from "../bold-markup.tsx";

const html = (text: string): string => renderToStaticMarkup(<>{renderBoldMarkup(text)}</>);

describe("renderBoldMarkup", () => {
  test("paired markers become strong runs", () => {
    expect(html("Nice **Golf**, 2015")).toBe(
      '<span>Nice </span><strong class="font-semibold">Golf</strong><span>, 2015</span>',
    );
  });

  test("a single marker stays literal text", () => {
    expect(html("Price ** incl. VAT")).toBe("Price ** incl. VAT");
  });
});
