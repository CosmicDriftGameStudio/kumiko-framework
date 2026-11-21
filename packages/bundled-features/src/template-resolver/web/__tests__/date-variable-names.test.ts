import { describe, expect, test } from "bun:test";
import { dateVariableNames } from "../date-variable-names.ts";

describe("dateVariableNames", () => {
  test("lists top-level date variables and date item fields of repeat variables by bare name", () => {
    const names = dateVariableNames({
      invoiceDate: { type: "date" },
      title: { type: "text" },
      lines: { type: "list", item: { servedOn: { type: "date" }, label: { type: "text" } } },
    });
    expect([...names].sort()).toEqual(["invoiceDate", "servedOn"]);
  });

  test("lists a name once and ignores malformed definitions", () => {
    expect(
      dateVariableNames({
        due: { type: "date" },
        lines: { type: "list", item: { due: { type: "date" } } },
        broken: "date",
        nothing: null,
      }),
    ).toEqual(["due"]);
  });
});
