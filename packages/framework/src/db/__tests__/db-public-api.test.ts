import { describe, expect, test } from "bun:test";
import * as dbApi from "../index.js";

describe("db public entry point", () => {
  test("does not re-export the unsafe raw grant escape hatch", () => {
    expect(Object.keys(dbApi)).not.toContain("withUnsafeRawGrant");
  });
});
