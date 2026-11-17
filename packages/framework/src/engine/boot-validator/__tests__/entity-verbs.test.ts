import { describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createSelectField, createTextField } from "../../factories.ts";
import { validateEntityVerbs } from "../entity-handler.ts";

type EntityOptions = Pick<EntityDefinition, "verbs" | "transitions">;

function validate(options: EntityOptions): void {
  const feature = defineFeature("t", (r) => {
    r.entity(
      createEntity({
        name: "thing",
        fields: {
          title: createTextField({ personal: false, reason: "test_fixture" }),
          status: createSelectField({ options: ["open", "closed", "archived"], default: "open" }),
        },
        ...options,
      }),
    );
  });
  validateEntityVerbs(feature);
}

const archiveTransition = { field: "status", from: ["open", "closed"], to: "archived" };

describe("validateEntityVerbs", () => {
  test("accepts a verb with a valid transition", () => {
    expect(() => validate({ verbs: { archived: { transition: archiveTransition } } })).not.toThrow();
  });

  test("accepts a verb without a transition", () => {
    expect(() => validate({ verbs: { flagged: {} } })).not.toThrow();
  });

  test("rejects a lifecycle verb name", () => {
    expect(() => validate({ verbs: { updated: {} } })).toThrow(/updated/);
    expect(() => validate({ verbs: { updated: {} } })).toThrow(/lifecycle verb/);
  });

  test("rejects a name with a dot", () => {
    expect(() => validate({ verbs: { "a.b": {} } })).toThrow(/a\.b/);
  });

  test("rejects a transition on a text field", () => {
    expect(() =>
      validate({ verbs: { archived: { transition: { ...archiveTransition, field: "title" } } } }),
    ).toThrow(/must be a select field/);
  });

  test("rejects a transition target that is not an option", () => {
    expect(() =>
      validate({ verbs: { archived: { transition: { ...archiveTransition, to: "nope" } } } }),
    ).toThrow(/"nope"/);
  });

  test("rejects an empty from list", () => {
    expect(() =>
      validate({ verbs: { archived: { transition: { ...archiveTransition, from: [] } } } }),
    ).toThrow(/empty "from"/);
  });

  test("rejects a pair the entity transitions do not allow", () => {
    expect(() =>
      validate({
        transitions: { status: { open: ["closed"] } },
        verbs: { archived: { transition: { field: "status", from: ["open"], to: "archived" } } },
      }),
    ).toThrow(/does not allow/);
  });
});
