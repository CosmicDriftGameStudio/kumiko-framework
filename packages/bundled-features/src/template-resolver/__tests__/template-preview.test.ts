import { describe, expect, test } from "bun:test";
import { type TemplateVariables, templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import { sampleValuesFor } from "../template-preview.js";

describe("sampleValuesFor", () => {
  test("uses the declared example of a scalar variable", () => {
    const values = sampleValuesFor({
      invoiceNumber: templateVariable.text({ example: "RE-2026-001" }),
      payUrl: templateVariable.link({ example: "https://pay.example.org/1" }),
      total: templateVariable.money({ example: { amount: 119, currency: "USD" } }),
      dueDate: templateVariable.date({ example: "2026-03-01" }),
    });
    expect(values).toEqual({
      invoiceNumber: "RE-2026-001",
      payUrl: "https://pay.example.org/1",
      total: { amount: 119, currency: "USD" },
      dueDate: "2026-03-01",
    });
  });

  test("falls back to fixed values per type, naming a text by its label or key", () => {
    const variables: TemplateVariables = {
      firstName: templateVariable.text({ label: "First name" }),
      company: templateVariable.text(),
      link: templateVariable.link(),
      total: templateVariable.money(),
      dueDate: templateVariable.date(),
    };
    const expected = {
      firstName: "[First name]",
      company: "[company]",
      link: "https://example.com",
      total: 0,
      dueDate: "2026-01-15",
    };
    expect(sampleValuesFor(variables)).toEqual(expected);
    expect(sampleValuesFor(variables)).toEqual(expected);
  });

  test("a list without example gets two rows built from the item fallbacks", () => {
    const values = sampleValuesFor({
      positions: templateVariable.list({
        label: templateVariable.text({ label: "Position" }),
        price: templateVariable.money(),
      }),
    });
    expect(values).toEqual({
      positions: [
        { label: "[Position]", price: 0 },
        { label: "[Position]", price: 0 },
      ],
    });
  });

  test("a list takes the first two example rows and fills missing rows and fields", () => {
    const withThree = sampleValuesFor({
      positions: templateVariable.list(
        { label: templateVariable.text(), price: templateVariable.money() },
        {
          example: [
            { label: "A", price: 1 },
            { label: "B", price: 2 },
            { label: "C", price: 3 },
          ],
        },
      ),
    });
    expect(withThree["positions"]).toEqual([
      { label: "A", price: 1 },
      { label: "B", price: 2 },
    ]);

    const withOnePartial = sampleValuesFor({
      positions: templateVariable.list(
        { label: templateVariable.text(), price: templateVariable.money() },
        { example: [{ label: "A" }] },
      ),
    });
    expect(withOnePartial["positions"]).toEqual([
      { label: "A", price: 0 },
      { label: "[label]", price: 0 },
    ]);
  });
});
