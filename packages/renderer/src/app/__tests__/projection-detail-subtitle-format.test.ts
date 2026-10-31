import { describe, expect, test } from "bun:test";
import type { NavApi } from "../nav.tsx";
import { buildSubtitleParts } from "../projection-detail-navigation.ts";

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};
const translate = (key: string) => key;
const SUBMITTED_AT = "2026-10-31T09:42:00.000Z";

function subtitleTexts(locale: string, spec: { readonly format: "timestamp" | "date" }) {
  return buildSubtitleParts(
    [{ field: "submittedAt", format: spec }],
    { submittedAt: SUBMITTED_AT },
    nav,
    [],
    undefined,
    undefined,
    translate,
    locale,
  ).map((part) => part.text);
}

describe("buildSubtitleParts format", () => {
  test("formats a part with its FormatSpec and keeps plain parts raw", () => {
    const parts = buildSubtitleParts(
      ["kind", { field: "submittedAt", format: { format: "date" } }],
      { kind: "bug", submittedAt: SUBMITTED_AT },
      nav,
      [],
      undefined,
      undefined,
      translate,
      "en",
    );
    expect(parts.map((part) => part.field)).toEqual(["kind", "submittedAt"]);
    expect(parts[0]?.text).toBe("bug");
    expect(parts[1]?.text).not.toBe(SUBMITTED_AT);
    expect(parts[1]?.text).toContain("2026");
  });

  test("uses the active locale for the date", () => {
    expect(subtitleTexts("de", { format: "date" })).toEqual(["31.10.2026"]);
    expect(subtitleTexts("en-US", { format: "date" })).toEqual(["10/31/2026"]);
  });

  test("drops a formatted part whose value is empty", () => {
    const parts = buildSubtitleParts(
      [{ field: "submittedAt", format: { format: "date" } }],
      { submittedAt: null },
      nav,
      [],
      undefined,
      undefined,
      translate,
      "en",
    );
    expect(parts).toEqual([]);
  });
});
