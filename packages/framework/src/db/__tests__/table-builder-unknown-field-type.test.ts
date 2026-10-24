import { describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";

import { buildEntityTable } from "../table-builder.ts";

// Entity definitions can arrive untyped (JSON configs, plugins), so the column
// emitter lookup must reject unknown types, including Object.prototype keys
// that a plain index access would resolve to a function.
function entityWithFieldType(type: string): EntityDefinition {
  return { fields: { probe: { type } } } as unknown as EntityDefinition;
}

describe("buildEntityTable with an unknown field type", () => {
  test("rejects a type that has no column emitter", () => {
    expect(() => buildEntityTable("unknownTypeProbe", entityWithFieldType("bogus"))).toThrow(
      "[Kumiko] unhandled field type",
    );
  });

  test.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "rejects the Object.prototype key %s",
    (prototypeKey) => {
      expect(() =>
        buildEntityTable("prototypeTypeProbe", entityWithFieldType(prototypeKey)),
      ).toThrow("[Kumiko] unhandled field type");
    },
  );
});
