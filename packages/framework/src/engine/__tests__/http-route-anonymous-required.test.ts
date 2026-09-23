import { describe, expect, test } from "bun:test";
import { defineFeature } from "../define-feature";

describe("r.httpRoute — anonymous is required", () => {
  test("missing anonymous → throws (JS caller without HttpRouteDefinition's type)", () => {
    expect(() =>
      defineFeature("feed", (r) => {
        r.httpRoute({
          method: "GET",
          path: "/feed.xml",
          handler: async () => new Response("ok"),
          // biome-ignore lint/suspicious/noExplicitAny: intentional type violation under test
        } as any);
      }),
    ).toThrow(/must declare anonymous: true \| false/);
  });

  test("anonymous: true → accepted", () => {
    expect(() =>
      defineFeature("feed", (r) => {
        r.httpRoute({
          method: "GET",
          path: "/feed.xml",
          anonymous: true,
          handler: async () => new Response("ok"),
        });
      }),
    ).not.toThrow();
  });

  test("anonymous: false → accepted", () => {
    expect(() =>
      defineFeature("feed", (r) => {
        r.httpRoute({
          method: "GET",
          path: "/feed.xml",
          anonymous: false,
          handler: async () => new Response("ok"),
        });
      }),
    ).not.toThrow();
  });
});
