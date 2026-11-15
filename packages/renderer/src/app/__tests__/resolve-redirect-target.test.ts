import { describe, expect, test } from "bun:test";
import type { FeatureSchema } from "@cosmicdrift/kumiko-framework/ui-types";
import type { NavApi } from "../nav.tsx";
import {
  navigateToRedirectTarget,
  resolveRedirectTarget,
  returnToWinsOverRedirect,
} from "../screen-shared.tsx";

const schema: FeatureSchema = {
  featureName: "inbox",
  entities: {},
  screens: [
    { id: "cockpit", type: "custom", renderer: { react: "stub" } },
    {
      id: "thread-detail",
      type: "projectionDetail",
      query: "inbox:query:thread:detail",
      layout: { sections: [{ title: "s", fields: ["subject"] }] },
    },
  ],
};

describe("resolveRedirectTarget searchParams", () => {
  test("custom target reads the declared search params from the payload", () => {
    const target = resolveRedirectTarget(
      { screen: "cockpit", searchParams: { cmd: "threadId" } },
      { threadId: "t-1" },
      schema,
      [],
    );
    expect(target).toEqual({
      screenId: "cockpit",
      entityId: undefined,
      tab: undefined,
      searchParams: { cmd: "t-1" },
    });
  });

  test("missing and non-string payload values are left out", () => {
    const target = resolveRedirectTarget(
      { screen: "cockpit", searchParams: { cmd: "threadId", n: "count", gone: "absent" } },
      { threadId: "t-1", count: 3 },
      schema,
      [],
    );
    expect(target.searchParams).toEqual({ cmd: "t-1" });
  });

  test("string redirect has no search params", () => {
    expect(resolveRedirectTarget("cockpit", { id: "x" }, schema, []).searchParams).toEqual({});
  });

  test("record target keeps its id next to the search params", () => {
    const target = resolveRedirectTarget(
      { screen: "thread-detail", idFrom: "threadId", searchParams: { cmd: "threadId" } },
      { threadId: "t-1" },
      schema,
      [],
    );
    expect(target.entityId).toBe("t-1");
    expect(target.searchParams).toEqual({ cmd: "t-1" });
  });
});

describe("custom redirect target id", () => {
  test("custom target with idFrom carries the payload id", () => {
    const target = resolveRedirectTarget(
      { screen: "cockpit", idFrom: "draftId" },
      { draftId: "d-1" },
      schema,
      [],
    );
    expect(target.entityId).toBe("d-1");
  });

  test("custom target without idFrom stays id-less", () => {
    const target = resolveRedirectTarget({ screen: "cockpit" }, { id: "d-1" }, schema, []);
    expect(target.entityId).toBeUndefined();
  });

  test("custom redirect with idFrom wins over returnTo, without idFrom it does not", () => {
    const returnTarget = { screenId: "origin" };
    expect(
      returnToWinsOverRedirect(returnTarget, { screen: "cockpit", idFrom: "draftId" }, schema, []),
    ).toBe(false);
    expect(returnToWinsOverRedirect(returnTarget, { screen: "cockpit" }, schema, [])).toBe(true);
  });
});

describe("navigateToRedirectTarget", () => {
  test("passes search params and tab together to the navigation", () => {
    const calls: unknown[][] = [];
    const nav: NavApi = {
      route: undefined,
      navigate: (...args) => {
        calls.push(args);
      },
      replace: () => {},
      hrefFor: () => "",
      searchParams: {},
      setSearchParams: () => {},
    };
    navigateToRedirectTarget(nav, {
      screenId: "cockpit",
      entityId: undefined,
      tab: "history",
      searchParams: { cmd: "t-1" },
    });
    expect(calls).toEqual([
      [{ screenId: "cockpit" }, { searchParams: { cmd: "t-1", tab: "history" } }],
    ]);
  });
});
