// H.2 build-time guard — mirrors notes-history-ownership.integration.test.ts's
// guard test. A where-rule in ownership.write can only ever deny (the write
// path has no SQL layer); framework boot validation rejects it too, this guard
// just fires earlier with the option name in the message. No DB needed — it
// runs at feature-construction time.

import { describe, expect, test } from "bun:test";
import { createTagsFeature } from "../feature";

describe("tags — boot guard rejects a where-rule in ownership.write", () => {
  test("createTagsFeature throws instead of shipping a deny-only ownership map", () => {
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
