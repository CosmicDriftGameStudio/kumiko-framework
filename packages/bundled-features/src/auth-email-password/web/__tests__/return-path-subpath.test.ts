import { describe, expect, test } from "bun:test";
import * as returnPathSubpath from "@cosmicdrift/kumiko-bundled-features/auth-email-password/return-path";
import * as returnPathModule from "../return-path.ts";

describe("auth-email-password/return-path subpath", () => {
  test("exposes exactly the return-path module, without the web barrel", () => {
    expect(Object.keys(returnPathSubpath).sort()).toEqual(
      [
        "MAX_RETURN_PATH_LENGTH",
        "RETURN_TO_QUERY_PARAM",
        "isSafeReturnPath",
        "readReturnToFromSearch",
      ].sort(),
    );
    expect(returnPathSubpath.isSafeReturnPath).toBe(returnPathModule.isSafeReturnPath);
  });
});
