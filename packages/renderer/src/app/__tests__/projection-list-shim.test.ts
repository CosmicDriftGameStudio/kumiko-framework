import { describe, expect, test } from "bun:test";
import { synthesizeProjectionEntity } from "../projection-list-shim.js";

describe("synthesizeProjectionEntity", () => {
  test("sortable applies to every column except those opting out with sortable: false", () => {
    const entity = synthesizeProjectionEntity(
      ["name", { field: "status", sortable: false }, { field: "createdAt" }],
      true,
    );
    expect(entity.fields["name"]).toMatchObject({ sortable: true });
    expect(entity.fields["status"]).toMatchObject({ sortable: false });
    expect(entity.fields["createdAt"]).toMatchObject({ sortable: true });
  });

  test("a screen that is not sortable keeps every column unsortable", () => {
    const entity = synthesizeProjectionEntity(["name", { field: "status", sortable: true }], false);
    expect(entity.fields["name"]).toMatchObject({ sortable: false });
    expect(entity.fields["status"]).toMatchObject({ sortable: false });
  });
});
