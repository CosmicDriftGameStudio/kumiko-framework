import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../engine/define-feature.js";
import { createEntity, createTextField } from "../../engine/factories.js";
import { createRegistry } from "../../engine/registry.js";
import type { AccessRule } from "../../engine/types/index.js";
import { collectAnonymousLiveEntities } from "../anonymous-live-entities.js";

const entityOnTable = (table: string) =>
  createEntity({
    table,
    fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
  });

type QueryDeclaration = {
  readonly name: string;
  readonly access: AccessRule;
  readonly liveEntities?: readonly string[];
};

function registryWith(queries: readonly QueryDeclaration[]) {
  const feature = defineFeature("demo", (r) => {
    r.entity("thing", entityOnTable("things"));
    r.entity("secret", entityOnTable("secrets"));
    for (const query of queries) {
      r.queryHandler(query.name, z.object({}), async () => ({}), {
        access: query.access,
        ...(query.liveEntities && { liveEntities: query.liveEntities }),
      });
    }
  });
  return createRegistry([feature]);
}

describe("collectAnonymousLiveEntities", () => {
  test("liveEntities of an anonymously callable query are collected", () => {
    const registry = registryWith([
      { name: "current", access: { roles: ["anonymous", "Admin"] }, liveEntities: ["thing"] },
    ]);
    expect([...collectAnonymousLiveEntities(registry)]).toEqual(["thing"]);
  });

  test("an entity name in an anonymous query's name grants nothing without liveEntities", () => {
    const registry = registryWith([
      { name: "thing:list", access: { roles: ["anonymous"] } },
      { name: "current", access: { roles: ["anonymous"] } },
    ]);
    expect(collectAnonymousLiveEntities(registry).size).toBe(0);
  });

  test("openToAll and non-anonymous roles never grant anonymous signals", () => {
    const registry = registryWith([
      { name: "secret:list", access: { openToAll: { reason: "signed-in users only" } } },
      { name: "secret:detail", access: { roles: ["Admin"] } },
      { name: "current", access: { roles: ["Admin"] }, liveEntities: ["secret"] },
    ]);
    expect(collectAnonymousLiveEntities(registry).size).toBe(0);
  });

  test("boot fails when liveEntities names an unregistered entity", () => {
    expect(() =>
      registryWith([
        { name: "current", access: { roles: ["anonymous"] }, liveEntities: ["Thing"] },
      ]),
    ).toThrow(/demo:query:current.*liveEntities "Thing"/);
  });
});
