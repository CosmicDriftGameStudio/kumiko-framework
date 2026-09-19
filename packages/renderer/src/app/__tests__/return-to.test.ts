import { describe, expect, test } from "bun:test";
import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "../feature-schema";
import { formatReturnTo, resolveReturnTarget, returnToParams, splitReturnTo } from "../return-to";

function schemaWith(featureName: string, screens: readonly ScreenDefinition[]): FeatureSchema {
  return { featureName, entities: {}, screens };
}

const listScreen: ScreenDefinition = {
  id: "token-list",
  type: "entityList",
  entity: "token",
  columns: ["name"],
};

const editScreen: ScreenDefinition = {
  id: "token-edit",
  type: "entityEdit",
  entity: "token",
  layout: { sections: [{ fields: ["name"] }] },
};

const detailScreen: ScreenDefinition = {
  id: "token-detail",
  type: "projectionDetail",
  query: "tokens:query:token:detail",
  layout: { sections: [{ fields: ["name"] }] },
};

const singletonDetailScreen: ScreenDefinition = {
  id: "my-settings",
  type: "projectionDetail",
  query: "tokens:query:settings:mine",
  singleton: true,
  layout: { sections: [{ fields: ["name"] }] },
};

const adminOnlyScreen: ScreenDefinition = {
  id: "admin-only",
  type: "custom",
  renderer: { react: "stub" },
  access: { roles: ["Admin"] },
};

const features: readonly FeatureSchema[] = [
  schemaWith("tokens", [
    listScreen,
    editScreen,
    detailScreen,
    singletonDetailScreen,
    adminOnlyScreen,
  ]),
];

describe("resolveReturnTarget", () => {
  test("valid short id resolves to a ScreenTarget", () => {
    expect(resolveReturnTarget("token-list", "token-create", features, undefined)).toEqual({
      screenId: "token-list",
    });
  });

  test("with entityId on an entityEdit screen", () => {
    expect(resolveReturnTarget("token-edit/abc-123", "token-create", features, undefined)).toEqual({
      screenId: "token-edit",
      entityId: "abc-123",
    });
  });

  test("with entityId on a projectionDetail screen", () => {
    expect(
      resolveReturnTarget("token-detail/abc-123", "token-create", features, undefined),
    ).toEqual({ screenId: "token-detail", entityId: "abc-123" });
  });

  test("accepts a '%'-containing entityId that decodes to a safe value", () => {
    expect(resolveReturnTarget("token-edit/abc%41", "token-create", features, undefined)).toEqual({
      screenId: "token-edit",
      entityId: "abc%41",
    });
  });

  test("undefined raw value", () => {
    expect(resolveReturnTarget(undefined, "token-create", features, undefined)).toBeUndefined();
  });

  test("empty string", () => {
    expect(resolveReturnTarget("", "token-create", features, undefined)).toBeUndefined();
  });

  test("rejects an unknown screen id", () => {
    expect(
      resolveReturnTarget("unknown-screen", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects a qualified screen id ('feature:screen:x')", () => {
    expect(
      resolveReturnTarget("tokens:screen:token-list", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects a protocol-relative value ('//evil.com')", () => {
    expect(resolveReturnTarget("//evil.com", "token-create", features, undefined)).toBeUndefined();
  });

  test("rejects an absolute URL ('https://evil.com')", () => {
    expect(
      resolveReturnTarget("https://evil.com", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects more than two segments ('a/b/c')", () => {
    expect(resolveReturnTarget("a/b/c", "token-create", features, undefined)).toBeUndefined();
  });

  test("rejects a trailing slash ('x/')", () => {
    expect(resolveReturnTarget("token-list/", "token-create", features, undefined)).toBeUndefined();
  });

  test("rejects a leading slash ('/x')", () => {
    expect(resolveReturnTarget("/token-list", "token-create", features, undefined)).toBeUndefined();
  });

  test("rejects a role-gated screen when roles are missing", () => {
    expect(resolveReturnTarget("admin-only", "token-create", features, undefined)).toBeUndefined();
  });

  test("accepts a role-gated screen when the role matches", () => {
    expect(resolveReturnTarget("admin-only", "token-create", features, ["Admin"])).toEqual({
      screenId: "admin-only",
    });
  });

  test("rejects the own screen (self)", () => {
    expect(
      resolveReturnTarget("token-create", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects an entityId on a list screen", () => {
    expect(
      resolveReturnTarget("token-list/abc-123", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects entityId '..'", () => {
    expect(
      resolveReturnTarget("token-edit/..", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects entityId '.'", () => {
    expect(
      resolveReturnTarget("token-edit/.", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects an entityId whose decoded form carries '?'", () => {
    expect(
      resolveReturnTarget("token-edit/abc%3Fx=1", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("a trailing host-state query resolves to the bare target", () => {
    expect(
      resolveReturnTarget("token-edit/abc?tab=keys", "token-create", features, undefined),
    ).toEqual({ screenId: "token-edit", entityId: "abc" });
  });

  test("a host-state query does not loosen validation", () => {
    expect(
      resolveReturnTarget("https://evil.com?tab=keys", "token-create", features, undefined),
    ).toBeUndefined();
    expect(
      resolveReturnTarget("//evil.com?tab=keys", "token-create", features, undefined),
    ).toBeUndefined();
    expect(
      resolveReturnTarget("token-edit/..?tab=keys", "token-create", features, undefined),
    ).toBeUndefined();
    expect(
      resolveReturnTarget("unknown-screen?tab=keys", "token-create", features, undefined),
    ).toBeUndefined();
    expect(
      resolveReturnTarget("admin-only?tab=keys", "token-create", features, undefined),
    ).toBeUndefined();
    expect(resolveReturnTarget("?tab=keys", "token-create", features, undefined)).toBeUndefined();
  });

  test("rejects entityId with '#'", () => {
    expect(
      resolveReturnTarget("token-edit/abc#frag", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects entityId with '\\\\'", () => {
    expect(
      resolveReturnTarget("token-edit/abc\\def", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects entityId with a space", () => {
    expect(
      resolveReturnTarget("token-edit/abc def", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects a percent-encoded entityId that decodes to '..'", () => {
    expect(
      resolveReturnTarget("token-edit/%2e%2e", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects a percent-encoded entityId that decodes to '.'", () => {
    expect(
      resolveReturnTarget("token-edit/%2E", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects a percent-encoded entityId that decodes to a slash", () => {
    expect(
      resolveReturnTarget("token-edit/%2Fx", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects a malformed percent-encoded entityId", () => {
    expect(
      resolveReturnTarget("token-edit/%E0%A4%A", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects a percent-encoded entityId that decodes to whitespace", () => {
    expect(
      resolveReturnTarget("token-edit/a%20b", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("rejects a non-singleton projectionDetail without an entityId", () => {
    expect(
      resolveReturnTarget("token-detail", "token-create", features, undefined),
    ).toBeUndefined();
  });

  test("accepts a singleton projectionDetail without an entityId", () => {
    expect(resolveReturnTarget("my-settings", "token-create", features, undefined)).toEqual({
      screenId: "my-settings",
    });
  });
});

describe("returnToParams", () => {
  test("no host -> {}", () => {
    expect(returnToParams(undefined, { screenId: "token-list" })).toEqual({});
  });

  test("target equals the host (self) -> {}", () => {
    expect(returnToParams({ screenId: "token-list" }, { screenId: "token-list" })).toEqual({});
  });

  test("target equals the host including entityId -> {}", () => {
    expect(
      returnToParams(
        { screenId: "token-edit", entityId: "abc" },
        { screenId: "token-edit", entityId: "abc" },
      ),
    ).toEqual({});
  });

  test("different target -> returnTo param", () => {
    expect(returnToParams({ screenId: "token-list" }, { screenId: "token-create" })).toEqual({
      returnTo: "token-list",
    });
  });

  test("host with entityId formats as 'screenId/entityId'", () => {
    expect(
      returnToParams({ screenId: "token-edit", entityId: "abc" }, { screenId: "token-create" }),
    ).toEqual({ returnTo: "token-edit/abc" });
  });
});

describe("formatReturnTo / splitReturnTo", () => {
  test("no host params formats exactly like before the snapshot existed", () => {
    expect(formatReturnTo({ screenId: "token-list" })).toBe("token-list");
    expect(formatReturnTo({ screenId: "token-list" }, {})).toBe("token-list");
    expect(formatReturnTo({ screenId: "token-edit", entityId: "abc" })).toBe("token-edit/abc");
  });

  test("host params round-trip through the value", () => {
    const raw = formatReturnTo(
      { screenId: "token-detail", entityId: "abc" },
      { tab: "keys", "orders.sort": "name", "orders.dir": "asc" },
    );
    expect(splitReturnTo(raw)).toEqual({
      path: "token-detail/abc",
      state: { tab: "keys", "orders.sort": "name", "orders.dir": "asc" },
    });
  });

  test("empty param values are left out of the snapshot", () => {
    expect(formatReturnTo({ screenId: "token-list" }, { q: "", tab: "keys" })).toBe(
      "token-list?tab=keys",
    );
  });

  test("two nesting levels round-trip one level per split", () => {
    const inner = formatReturnTo({ screenId: "token-list" }, { returnTo: "settings" });
    const outer = formatReturnTo({ screenId: "token-edit", entityId: "abc" }, { returnTo: inner });

    const first = splitReturnTo(outer);
    expect(first.path).toBe("token-edit/abc");
    expect(first.state["returnTo"]).toBe("token-list?returnTo=settings");

    const second = splitReturnTo(first.state["returnTo"] as string);
    expect(second.path).toBe("token-list");
    expect(second.state).toEqual({ returnTo: "settings" });
  });

  test("a fourth level is dropped, the rest of the snapshot survives", () => {
    const level3 = formatReturnTo(
      { screenId: "token-list" },
      { returnTo: formatReturnTo({ screenId: "token-detail" }, { returnTo: "settings" }) },
    );
    const level4 = formatReturnTo({ screenId: "token-edit" }, { returnTo: level3, tab: "keys" });

    expect(splitReturnTo(level4)).toEqual({ path: "token-edit", state: { tab: "keys" } });
  });

  test("an over-long snapshot degrades to the bare target", () => {
    expect(formatReturnTo({ screenId: "token-list" }, { q: "x".repeat(600) })).toBe("token-list");
  });

  test("returnToParams carries the host snapshot", () => {
    expect(
      returnToParams({ screenId: "token-list" }, { screenId: "token-create" }, { tab: "keys" }),
    ).toEqual({ returnTo: "token-list?tab=keys" });
  });
});
