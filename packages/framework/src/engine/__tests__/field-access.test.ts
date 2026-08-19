import { describe, expect, test } from "bun:test";
import { checkWriteFieldRoles, filterReadFields } from "../field-access";
import type { EntityDefinition } from "../types";

const entity: EntityDefinition = {
  fields: {
    title: { type: "text", access: { read: { editor: "all" }, write: { editor: "all" } } },
    secret: { type: "text", access: { read: { admin: "all" }, write: { admin: "all" } } },
  },
};

const editor = { id: "u1", tenantId: "t1", roles: ["editor"] as const };
const admin = { id: "u2", tenantId: "t1", roles: ["admin"] as const };

describe("filterReadFields", () => {
  test("strips fields the user cannot read", () => {
    const row = { id: 1, title: "Hello", secret: "hidden" };
    const filtered = filterReadFields(entity, row, editor);
    expect(filtered["title"]).toBe("Hello");
    expect(filtered["secret"]).toBeUndefined();
  });

  test("keeps restricted fields for allowed roles", () => {
    const row = { id: 1, title: "Hello", secret: "visible" };
    const filtered = filterReadFields(entity, row, admin);
    expect(filtered["secret"]).toBe("visible");
  });

  test("filters each row of an embedded list, keeping it an array", () => {
    const entityWithLines: EntityDefinition = {
      fields: {
        lines: {
          type: "embedded",
          multiple: true,
          schema: {
            accountId: { type: "text" },
            internalNote: { type: "text", access: { read: { admin: "all" } } },
          },
        },
      },
    };
    const row = {
      lines: [
        { accountId: "bank", internalNote: "review me" },
        { accountId: "rent", internalNote: "and me" },
      ],
    };

    expect(filterReadFields(entityWithLines, row, editor)["lines"]).toEqual([
      { accountId: "bank" },
      { accountId: "rent" },
    ]);
    expect(filterReadFields(entityWithLines, row, admin)["lines"]).toEqual(row.lines);
  });
});

describe("checkWriteFieldRoles", () => {
  test("returns denied field name when role missing", () => {
    expect(checkWriteFieldRoles(entity, { secret: "x" }, editor)).toBe("secret");
  });

  test("returns null when all changed fields are allowed", () => {
    expect(checkWriteFieldRoles(entity, { title: "x" }, editor)).toBeNull();
  });
});
