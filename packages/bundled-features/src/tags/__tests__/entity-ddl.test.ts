import { describe, expect, test } from "bun:test";
import { deriveEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { createTagAssignmentEntity } from "../entity.ts";

const EXPECTED_INDEXES = [
  expect.objectContaining({
    name: "read_tag_assignments_tenant_id_entity_type_entity_id_idx",
    columns: ["tenant_id", "entity_type", "entity_id"],
  }),
  expect.objectContaining({
    name: "read_tag_assignments_tenant_id_tag_id_idx",
    columns: ["tenant_id", "tag_id"],
  }),
];

describe("tag-assignment entity — DDL", () => {
  test("tag-assignment table is indexed by host and by tag", () => {
    const meta = deriveEntityTableMeta("tag-assignment", createTagAssignmentEntity(undefined, ["note"]));
    expect(meta.indexes).toEqual(expect.arrayContaining(EXPECTED_INDEXES));
  });

  test("the parents variant carries the same indexes", () => {
    const meta = deriveEntityTableMeta(
      "tag-assignment",
      createTagAssignmentEntity(undefined, ["note"]),
    );
    expect(meta.indexes).toEqual(expect.arrayContaining(EXPECTED_INDEXES));
  });
});
