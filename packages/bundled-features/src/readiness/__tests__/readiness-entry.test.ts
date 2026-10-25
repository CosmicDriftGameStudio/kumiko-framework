import { describe, expect, test } from "bun:test";
import { ProbeTextKeys } from "@cosmicdrift/kumiko-bundled-features/readiness";
import { READINESS_I18N } from "../i18n.ts";

describe("readiness package entry", () => {
  test("exports the runner's text keys, each with an English text", () => {
    const keys = Object.values(ProbeTextKeys);

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => READINESS_I18N[key] === undefined)).toEqual([]);
  });
});
