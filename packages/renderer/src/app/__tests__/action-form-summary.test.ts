import { describe, expect, test } from "bun:test";
import type { Translate } from "../../headless/index.ts";
import { resolveActionFormSummary } from "../screen-shared.tsx";

const MESSAGES: Readonly<Record<string, string>> = {
  "contact:report.hint": "Goes straight to the {appName} team",
  "contact:report.summary": "About {subject}",
};

const translate: Translate = (key, params) =>
  (MESSAGES[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params?.[name];
    return typeof value === "string" ? value : match;
  });

describe("resolveActionFormSummary", () => {
  test("fills placeholders from the fixed params of the definition", () => {
    const summary = resolveActionFormSummary(
      { title: "contact:report.hint", params: { appName: "publicstatus" } },
      undefined,
      translate,
      "en-US",
    );
    expect(summary).toEqual({ title: "Goes straight to the publicstatus team" });
  });

  test("combines prefill values with fixed params, the fixed params win on a clash", () => {
    const summary = resolveActionFormSummary(
      {
        title: "contact:report.hint",
        subtitle: "contact:report.summary",
        params: { appName: "publicstatus" },
      },
      { subject: "Monitor down", appName: "spoofed" },
      translate,
      "en-US",
    );
    expect(summary).toEqual({
      title: "Goes straight to the publicstatus team",
      subtitle: "About Monitor down",
    });
  });
});
