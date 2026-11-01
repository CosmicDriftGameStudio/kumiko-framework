import { describe, expect, test } from "bun:test";
import { type AppConfig, defineAppConfig, findApiDocsConfigProblems } from "../index.ts";

const baseConfig: AppConfig = {
  features: [],
  client: { entries: ["src/client.tsx"] },
  ports: { dev: 4173, e2e: 4174 },
};

describe("apiDocs config", () => {
  test("a valid block passes", () => {
    const apiDocs = {
      locales: ["en", "de"],
      uiOnlyWrites: [{ pattern: "helpdesk:write:ticket:*", reason: "agents work in the app" }],
    };
    expect(findApiDocsConfigProblems(apiDocs)).toEqual([]);
    const config = { ...baseConfig, apiDocs };
    expect(defineAppConfig(config)).toBe(config);
  });

  test("empty and duplicate locales are reported", () => {
    expect(findApiDocsConfigProblems({ locales: [] })).toEqual([
      "apiDocs.locales must not be empty",
    ]);
    expect(findApiDocsConfigProblems({ locales: ["en", "en"] })).toEqual([
      "apiDocs.locales must not contain duplicates",
    ]);
  });

  test("an empty webhookDelivery text is reported", () => {
    expect(findApiDocsConfigProblems({ webhookDelivery: { en: "Signed.", de: " " } })).toEqual([
      'apiDocs.webhookDelivery: "de" text must not be empty',
    ]);
  });

  test("uiOnlyWrites needs a pattern and a reason", () => {
    expect(
      findApiDocsConfigProblems({
        uiOnlyWrites: [
          { pattern: "a:write:b:c", reason: "  " },
          { pattern: "", reason: "why" },
        ],
      }),
    ).toEqual([
      'apiDocs.uiOnlyWrites: "a:write:b:c" needs a non-empty reason',
      "apiDocs.uiOnlyWrites: pattern must not be empty",
    ]);
  });

  test("defineAppConfig throws with the problem in the message", () => {
    expect(() => defineAppConfig({ ...baseConfig, apiDocs: { locales: [] } })).toThrow(
      "apiDocs.locales must not be empty",
    );
  });
});
