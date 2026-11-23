import { afterEach, describe, expect, test } from "bun:test";
import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { registerUnsavedInputSource, setLeaveConfirmer } from "../../leave-guard.ts";
import type { FeatureSchema } from "../feature-schema.ts";
import type { NavApi, NavTarget } from "../nav.tsx";
import {
  formatReturnTo,
  navigateToReturn,
  navigateWithReturnTo,
  type ReturnHost,
  resolveReturnTarget,
  returnToParams,
  splitReturnTo,
  useCarriedReturnInput,
} from "../return-to.tsx";

// hrefFor maps entity ObjectTargets to their detail screen, mirroring resolveTarget.
function fakeNav(searchParams: Readonly<Record<string, string>> = {}): {
  readonly nav: NavApi;
  readonly navigateCalls: NavTarget[];
  readonly setSearchParamsCalls: ReadonlyArray<Readonly<Record<string, string | null>>>;
} {
  const navigateCalls: NavTarget[] = [];
  const setSearchParamsCalls: Array<Readonly<Record<string, string | null>>> = [];
  const hrefFor = (target: NavTarget): string =>
    "screenId" in target
      ? `/${[target.screenId, target.entityId].filter((s) => s !== undefined).join("/")}`
      : `/vehicle-detail/${target.id}`;
  const nav: NavApi = {
    route: undefined,
    navigate: (target) => navigateCalls.push(target),
    replace: () => {},
    hrefFor,
    searchParams,
    setSearchParams: (updates) => setSearchParamsCalls.push(updates),
  };
  return { nav, navigateCalls, setSearchParamsCalls };
}

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

const recordActionScreen: ScreenDefinition = {
  id: "token-send",
  type: "actionForm",
  handler: "tokens:write:token:send",
  fields: {},
  layout: { sections: [{ fields: [] }] },
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
    recordActionScreen,
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

  test("with entityId on an actionForm opened for one record", () => {
    expect(resolveReturnTarget("token-send/abc-123", "token-create", features, undefined)).toEqual({
      screenId: "token-send",
      entityId: "abc-123",
    });
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

describe("navigateWithReturnTo — ObjectTarget", () => {
  test("target resolves away from the host: returnTo carries the host's search-params snapshot", () => {
    const { nav, navigateCalls, setSearchParamsCalls } = fakeNav({ tab: "active" });
    navigateWithReturnTo(nav, { entity: "vehicle", id: "abc" }, { screenId: "vehicle-list" });

    expect(navigateCalls).toEqual([{ entity: "vehicle", id: "abc" }]);
    expect(setSearchParamsCalls).toEqual([{ returnTo: "vehicle-list?tab=active" }]);
  });

  test("target resolves to the host itself: no returnTo", () => {
    const { nav, setSearchParamsCalls } = fakeNav();
    navigateWithReturnTo(
      nav,
      { entity: "vehicle", id: "abc" },
      { screenId: "vehicle-detail", entityId: "abc" },
    );

    expect(setSearchParamsCalls).toEqual([]);
  });

  test("no host: only params, no returnTo", () => {
    const { nav, setSearchParamsCalls } = fakeNav();
    navigateWithReturnTo(nav, { entity: "vehicle", id: "abc" }, undefined, { name: "Vehicle A" });

    expect(setSearchParamsCalls).toEqual([{ name: "Vehicle A" }]);
  });
});

describe("navigateToReturn", () => {
  const raw = formatReturnTo({ screenId: "token-list" }, { tab: "keys", returnTo: "settings" });

  test("restores the host state, including its own returnTo, on the named target", () => {
    const { nav, navigateCalls, setSearchParamsCalls } = fakeNav({ returnTo: raw });
    navigateToReturn(nav, { screenId: "token-list" });

    expect(navigateCalls).toEqual([{ screenId: "token-list" }]);
    expect(setSearchParamsCalls).toEqual([{ tab: "keys", returnTo: "settings" }]);
  });

  test("a target the returnTo value does not name gets no foreign state", () => {
    const { nav, setSearchParamsCalls } = fakeNav({ returnTo: raw });
    navigateToReturn(nav, { screenId: "other-screen" });

    expect(setSearchParamsCalls).toEqual([{ returnTo: null }]);
  });
});

let probedInput: Readonly<Record<string, unknown>> | undefined;
function CarriedInputProbe(props: { readonly at: ReturnHost }): null {
  probedInput = useCarriedReturnInput(props.at);
  return null;
}
function readCarried(at: ReturnHost): Readonly<Record<string, unknown>> | undefined {
  renderToString(createElement(CarriedInputProbe, { at }));
  return probedInput;
}

describe("navigateWithReturnTo — carried input", () => {
  const host: ReturnHost = { screenId: "letter-send", entityId: "lease-1" };
  const editor = { screenId: "draft-editor", entityId: "draft-1" };
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function dirtyFormWithConfirmer(): { readonly questions: number[] } {
    const questions: number[] = [];
    cleanups.push(registerUnsavedInputSource(() => true));
    cleanups.push(setLeaveConfirmer(() => questions.push(1)));
    return { questions };
  }

  test("leaves a dirty form without asking and hands the input back on return, once", () => {
    const { questions } = dirtyFormWithConfirmer();
    const { nav, navigateCalls } = fakeNav();
    navigateWithReturnTo(nav, editor, host, undefined, { envelope: "large" });

    expect(questions).toEqual([]);
    expect(navigateCalls).toEqual([editor]);
    expect(readCarried(host)).toBeUndefined();

    // The host form unmounted with the jump; the editor it returns from holds nothing unsaved.
    for (const cleanup of cleanups.splice(0)) cleanup();
    navigateToReturn(fakeNav().nav, host);
    expect(readCarried(host)).toEqual({ envelope: "large" });
    expect(readCarried(host)).toBeUndefined();
  });

  test("another record's form does not receive the carried input", () => {
    navigateWithReturnTo(fakeNav().nav, editor, host, undefined, { envelope: "large" });
    navigateToReturn(fakeNav().nav, host);

    expect(readCarried({ screenId: "letter-send", entityId: "lease-2" })).toBeUndefined();
  });

  test("without carry a dirty form still asks", () => {
    const { questions } = dirtyFormWithConfirmer();
    navigateWithReturnTo(fakeNav().nav, editor, host);

    expect(questions).toEqual([1]);
  });
});
