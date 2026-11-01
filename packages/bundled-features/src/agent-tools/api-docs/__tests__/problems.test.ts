import { describe, expect, test } from "bun:test";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { generateApiDocs } from "../generate.ts";
import { buildTicketingFeature, fixtureConfig, fixtureInput } from "./fixtures.ts";

const kinds = (problems: readonly { kind: string }[]) => problems.map((p) => p.kind);

describe("generateApiDocs problems", () => {
  test("a UI write that no scope grants is reported with its screens", () => {
    const { problems } = generateApiDocs(fixtureInput());
    expect(problems).toContainEqual({
      kind: "uiWriteOutsideScopes",
      qn: "ticketing:write:ticket:escalate",
      screens: ["ticketing:screen:escalate-ticket"],
    });
  });

  test("uiOnlyWrites suppresses the report and an unmatched pattern is reported", () => {
    const { problems } = generateApiDocs(
      fixtureInput({
        config: {
          ...fixtureConfig,
          uiOnlyWrites: [
            { pattern: "ticketing:write:ticket:*", reason: "agents escalate in the app" },
            { pattern: "ticketing:write:nothing:*", reason: "matches nothing" },
          ],
        },
      }),
    );
    expect(kinds(problems)).not.toContain("uiWriteOutsideScopes");
    expect(problems).toContainEqual({
      kind: "unusedUiOnlyWrite",
      pattern: "ticketing:write:nothing:*",
    });
  });

  test("a missing description translation is reported per handler and locale, not for en", () => {
    const { problems } = generateApiDocs(fixtureInput());
    const missing = problems.flatMap((p) =>
      p.kind === "descriptionTranslationMissing" ? [`${p.qn} ${p.locale}`] : [],
    );
    expect(missing).toContain("ticketing:write:ticket:create de");
    expect(missing).not.toContain("ticketing:write:ticket:close de");
    expect(missing.some((entry) => entry.endsWith(" en"))).toBe(false);
  });

  test("handlers without a description are doc gaps", () => {
    const { problems } = generateApiDocs(fixtureInput());
    expect(problems.flatMap((p) => (p.kind === "docGap" ? [p.gap.qn] : []))).toContain(
      "ticketing:write:ticket:create",
    );
  });

  test("without a personal-access-tokens feature nothing is generated", () => {
    const { files, problems } = generateApiDocs(
      fixtureInput({ registry: createRegistry([buildTicketingFeature()]) }),
    );
    expect(files.size).toBe(0);
    expect(problems).toEqual([{ kind: "patFeatureMissing" }]);
  });

  test("a text override with an unknown key or placeholder is reported and ignored", () => {
    const { files, problems } = generateApiDocs(
      fixtureInput({
        config: {
          ...fixtureConfig,
          texts: {
            en: {
              "overview.intro": "Custom intro for {unknown}.",
              "overview.title": "Structure is fixed",
              "overview.retry.body": "Custom retry text.",
            },
          },
        },
      }),
    );
    expect(problems.filter((p) => p.kind === "invalidTextOverride").map((p) => p.key)).toEqual([
      "overview.intro",
      "overview.title",
    ]);
    const overview = files.get("en/overview.md") ?? "";
    expect(overview).toContain("Custom retry text.");
    expect(overview).not.toContain("Custom intro");
  });

  test("the plan note is added to the tokens page of its locale", () => {
    const { files } = generateApiDocs(
      fixtureInput({ config: { ...fixtureConfig, planNote: { de: "Im Team-Tarif enthalten." } } }),
    );
    expect(files.get("de/tokens.md")).toContain("Im Team-Tarif enthalten.");
    expect(files.get("en/tokens.md")).not.toContain("Team-Tarif");
  });
});
