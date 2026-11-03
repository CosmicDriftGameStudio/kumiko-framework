import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { consoleCallsMentioning } from "@cosmicdrift/kumiko-testing/helpers";
import { buildServerGroups, freshLoadState } from "../list-server-groups.ts";

const texts: Record<string, string> = {
  "old.label": "{count} entries, last {lastDate} ({value})",
  "new.label": "{count} entries ({value})",
};

function build(labelKey: string) {
  return buildServerGroups({
    answer: [{ key: "open", label: "Open", count: 3, measures: [] }],
    groupField: "status",
    declared: { field: "status", label: labelKey },
    state: freshLoadState("reset"),
    base: {},
    pageSize: 25,
    paging: "offset",
    measures: [],
    translate: (key, params) =>
      (texts[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
        params !== undefined && name in params ? String(params[name]) : match,
      ),
  });
}

describe("group header label", () => {
  let warn: ReturnType<typeof spyOn<Console, "warn">>;
  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  test("a text still using the removed {lastDate} placeholder renders without it and warns once", () => {
    const first = build("old.label").groups[0]?.label;
    build("old.label");
    expect(first).toBe("3 entries, last  (Open)");
    expect(consoleCallsMentioning(warn, "old.label")).toHaveLength(1);
  });

  test("a current text is left alone and does not warn", () => {
    expect(build("new.label").groups[0]?.label).toBe("3 entries (Open)");
    expect(consoleCallsMentioning(warn, "new.label")).toHaveLength(0);
  });
});
