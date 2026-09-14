import { describe, expect, test } from "bun:test";
import { readOptionalAccessRule } from "../extractors/hooks";

describe("readOptionalAccessRule — openToAll.personalData", () => {
  test("keeps personalData: tenant-members on the object form", () => {
    expect(
      readOptionalAccessRule({
        openToAll: { reason: "members edit their team roster", personalData: "tenant-members" },
      }),
    ).toEqual({
      openToAll: { reason: "members edit their team roster", personalData: "tenant-members" },
    });
  });

  test("drops an unknown personalData value", () => {
    expect(
      readOptionalAccessRule({
        openToAll: { reason: "signup", personalData: "public-intake" },
      }),
    ).toEqual({ openToAll: { reason: "signup" } });
  });

  test("the deprecated openToAll: true form is not extracted — fail-closed, consistent with isOpenToAllGranted", () => {
    expect(
      readOptionalAccessRule({ openToAll: true, personalData: "tenant-members" }),
    ).toBeUndefined();
  });
});
