import { describe, expect, test } from "vitest";
import { createPgAdapter } from "../pg-adapter";
import type { DbAdapter } from "../types";

describe("DbAdapter interface", () => {
  test("createPgAdapter returns DbAdapter", () => {
    // createPgAdapter should exist and return the right shape
    const adapter: DbAdapter = createPgAdapter({
      url: "postgresql://fake:fake@localhost:15432/fake",
    });

    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.close).toBe("function");
    expect(typeof adapter.getConnection).toBe("function");
  });
});
