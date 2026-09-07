// H.2 boot guard — mirrors notes-history-ownership.integration.test.ts's
// guard test. A where-rule in ownership.write boots fine (the boot-validator
// has no where-specific handling) and only blows up the first time
// assign-tag's create() hits it (userCanCreateFieldRow throws on
// `kind: "where"`, unlike update/delete/forget which silently deny). No DB
// needed — the guard fires at feature-construction time.

import { describe, expect, test } from "bun:test";
import { createTagsFeature } from "../feature";

describe("tags — boot guard rejects a where-rule in ownership.write", () => {
  test("createTagsFeature throws instead of shipping a create()-time landmine", () => {
    expect(() =>
      createTagsFeature({
        ownership: {
          write: {
            TenantMember: { kind: "where", where: () => ({ sqlText: "1=1", params: [] }) },
          },
        },
      }),
    ).toThrow(/ownership\.write must not contain a.*where/);
  });
});
