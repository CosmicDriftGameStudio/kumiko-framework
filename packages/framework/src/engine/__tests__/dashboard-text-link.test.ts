import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

function dashboardWithLink(link: { readonly screen: string; readonly roles?: readonly string[] }) {
  return defineFeature("app", (r) => {
    r.screen({
      id: "plans",
      type: "dashboard",
      panels: [{ kind: "text", id: "t", blocks: [{ kind: "paragraph", text: "app:plans" }] }],
    });
    r.screen({
      id: "overview",
      type: "dashboard",
      panels: [
        {
          kind: "text",
          id: "hint",
          blocks: [{ kind: "link", text: "app:show-plans", ...link }],
        },
      ],
    });
  });
}

describe("validateBoot — dashboard text link block", () => {
  test("a link to a registered screen boots", () => {
    expect(() =>
      validateBoot([dashboardWithLink({ screen: "plans", roles: ["TenantAdmin"] })]),
    ).not.toThrow();
  });

  test("a link to an unknown screen throws", () => {
    expect(() => validateBoot([dashboardWithLink({ screen: "missing" })])).toThrow(
      /link block screen "missing" does not resolve to a registered screen/,
    );
  });

  test("an empty roles list throws", () => {
    expect(() => validateBoot([dashboardWithLink({ screen: "plans", roles: [] })])).toThrow(
      /empty roles list/,
    );
  });
});
