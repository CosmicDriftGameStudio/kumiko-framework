import { describe, expect, test } from "bun:test";
import type { DbConnection } from "../connection";
import { columnNamesOf, tableExists } from "../schema-inspection";

describe("schema-inspection — resolveUnsafeClient guard", () => {
  // A db handle without `.unsafe` on $client / session.client / itself used to
  // reach the query call as `undefined` and crash callers with an opaque
  // "unsafe is not a function". The guard must surface a named, actionable error.
  const noUnsafe = {} as unknown as DbConnection;

  test("tableExists throws a named error when no .unsafe fn resolves", async () => {
    await expect(tableExists(noUnsafe, "public.x")).rejects.toThrow(
      /resolveUnsafeClient: no `\.unsafe/,
    );
  });

  test("columnNamesOf throws the same named error", async () => {
    await expect(columnNamesOf(noUnsafe, "x")).rejects.toThrow(/resolveUnsafeClient: no `\.unsafe/);
  });

  test("tableExists throws the same named error when .unsafe is a non-function value", async () => {
    const notAFunction = { unsafe: "notafunction" } as unknown as DbConnection;
    await expect(tableExists(notAFunction, "public.x")).rejects.toThrow(
      /resolveUnsafeClient: no `\.unsafe/,
    );
  });
});
