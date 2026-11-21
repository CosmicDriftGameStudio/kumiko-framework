import { describe, expect, test } from "bun:test";
import { resolveSuccessFacts } from "../action-form-support.tsx";

const translate = (key: string): string => `t(${key})`;

describe("resolveSuccessFacts valueIsI18nKey", () => {
  test("translates the value when the fact declares an i18n key", () => {
    const facts = resolveSuccessFacts(
      [{ field: "reason", label: "k.reason", valueIsI18nKey: true }],
      { reason: "k.reason.loopback" },
      translate,
      "en-US",
    );
    expect(facts).toEqual([{ key: "0", label: "t(k.reason)", lines: ["t(k.reason.loopback)"] }]);
  });

  test("shows the raw value without the flag", () => {
    const facts = resolveSuccessFacts(
      [{ field: "reason", label: "k.reason" }],
      { reason: "k.reason.loopback" },
      translate,
      "en-US",
    );
    expect(facts).toEqual([{ key: "0", label: "t(k.reason)", lines: ["k.reason.loopback"] }]);
  });
});
