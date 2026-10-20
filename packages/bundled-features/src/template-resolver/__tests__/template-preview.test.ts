import { describe, expect, test } from "bun:test";
import { type TemplateVariables, templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import {
  encodedAttachmentBytes,
  estimateMailBytes,
  MIME_PART_OVERHEAD_BYTES,
  sampleValuesFor,
} from "../template-preview.ts";
import { MAIL_PREVIEW_MAX_BYTES } from "../web/constants.ts";

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

  test("a label given as i18n key names the sample by its translation", () => {
    const labelText = (label: string): string =>
      label === "status:mail.variable.pageName" ? "Name der Statusseite" : label;
    const values = sampleValuesFor(
      {
        pageName: templateVariable.text({ label: "status:mail.variable.pageName" }),
        lines: templateVariable.list({
          entry: templateVariable.richText({ label: "status:mail.variable.pageName" }),
        }),
      },
      labelText,
    );
    expect(values["pageName"]).toBe("[Name der Statusseite]");
    expect(values["lines"]).toContainEqual({ entry: "<p>[Name der Statusseite]</p>" });
  });

  test("a text example given as i18n key reads as its translation, other types stay as declared", () => {
    const labelText = (key: string): string =>
      ({ "status:mail.example.title": "Neue Störung", "status:mail.example.stage": "Prüfung" })[
        key
      ] ?? key;
    const values = sampleValuesFor(
      {
        title: templateVariable.text({ example: "status:mail.example.title" }),
        plain: templateVariable.text({ example: "Wartung" }),
        url: templateVariable.link({ example: "https://status.example.org" }),
        updates: templateVariable.list(
          { stage: templateVariable.text(), at: templateVariable.date() },
          { example: [{ stage: "status:mail.example.stage", at: "2026-03-01" }] },
        ),
      },
      labelText,
    );
    expect(values["title"]).toBe("Neue Störung");
    expect(values["plain"]).toBe("Wartung");
    expect(values["url"]).toBe("https://status.example.org");
    expect(values["updates"]).toContainEqual({ stage: "Prüfung", at: "2026-03-01" });
  });

  test("a list without example gets three rows built from the item fallbacks", () => {
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
        { label: "[Position]", price: 0 },
      ],
    });
  });

  test("a list takes up to three example rows and fills missing rows and fields", () => {
    const withThree = sampleValuesFor({
      positions: templateVariable.list(
        { label: templateVariable.text(), price: templateVariable.money() },
        {
          example: [
            { label: "A", price: 1 },
            { label: "B", price: 2 },
            { label: "C", price: 3 },
            { label: "D", price: 4 },
          ],
        },
      ),
    });
    expect(withThree["positions"]).toEqual([
      { label: "A", price: 1 },
      { label: "B", price: 2 },
      { label: "C", price: 3 },
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
      { label: "[label]", price: 0 },
    ]);
  });
});

describe("estimateMailBytes", () => {
  const inlineImage = (sizeBytes: number) =>
    ({ kind: "inline", cid: "logo", name: "logo", sizeBytes }) as const;

  test("counts attachments base64-encoded plus a fixed part overhead", () => {
    expect(encodedAttachmentBytes(3)).toBe(4 + MIME_PART_OVERHEAD_BYTES);
    expect(encodedAttachmentBytes(4)).toBe(8 + MIME_PART_OVERHEAD_BYTES);
  });

  test("a raw size just under the cap exceeds it once encoded", () => {
    const rawUnderCap = MAIL_PREVIEW_MAX_BYTES - 1024;
    const total = estimateMailBytes({
      html: "",
      text: "",
      attachments: [inlineImage(rawUnderCap)],
    });
    expect(rawUnderCap).toBeLessThan(MAIL_PREVIEW_MAX_BYTES);
    expect(total).toBeGreaterThan(MAIL_PREVIEW_MAX_BYTES);
  });

  test("an attachment whose encoded size fits stays under the cap, and each part adds its overhead", () => {
    const fitting = Math.floor(((MAIL_PREVIEW_MAX_BYTES - MIME_PART_OVERHEAD_BYTES) / 4) * 3) - 3;
    const one = estimateMailBytes({ html: "", text: "", attachments: [inlineImage(fitting)] });
    expect(one).toBeLessThanOrEqual(MAIL_PREVIEW_MAX_BYTES);
    const two = estimateMailBytes({
      html: "",
      text: "",
      attachments: [inlineImage(fitting), inlineImage(0)],
    });
    expect(two - one).toBe(MIME_PART_OVERHEAD_BYTES);
  });
});
