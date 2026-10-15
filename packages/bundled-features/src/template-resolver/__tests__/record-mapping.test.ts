import { describe, expect, test } from "bun:test";
import { mapRecordToVariables } from "../record-mapping";

describe("mapRecordToVariables", () => {
  const mapping = {
    entity: "contact",
    map: { name: "name", city: "address.city", owner: "owner.name", number: "id" },
  };

  test("reads plain and dotted paths", () => {
    expect(
      mapRecordToVariables(mapping, {
        id: "c1",
        name: "Anna",
        address: { city: "Berlin" },
        owner: { name: "Bob" },
      }),
    ).toEqual({ name: "Anna", city: "Berlin", owner: "Bob", number: "c1" });
  });

  test("leaves out variables whose path is missing", () => {
    expect(mapRecordToVariables(mapping, { name: "Anna", address: null })).toEqual({
      name: "Anna",
    });
  });

  test("never reads through the prototype", () => {
    const polluted = mapRecordToVariables(
      {
        entity: "contact",
        map: { a: "constructor", b: "__proto__", c: "toString", d: "name.length" },
      },
      { name: "Anna" },
    );
    expect(polluted).toEqual({});
  });
});
