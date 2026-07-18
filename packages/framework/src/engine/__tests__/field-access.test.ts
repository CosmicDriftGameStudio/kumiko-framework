import { describe, expect, test } from "bun:test";
import { checkWriteFieldRoles, filterReadFields, PII_MASKED_VALUE } from "../field-access";
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

  test("masks piiEncrypted fields instead of stripping them (kumiko-platform#463)", () => {
    const entityWithPii: EntityDefinition = {
      fields: {
        ...entity.fields,
        iban: {
          type: "text",
          piiEncrypted: true,
          tenantOwned: true,
          access: { read: { admin: "all" } },
        },
      },
    };
    const row = { id: 1, title: "Hello", secret: "hidden", iban: "DE89370400440532013000" };

    const filteredForEditor = filterReadFields(entityWithPii, row, editor);
    expect(filteredForEditor["secret"]).toBeUndefined();
    expect(filteredForEditor["iban"]).toBe(PII_MASKED_VALUE);

    const filteredForAdmin = filterReadFields(entityWithPii, row, admin);
    expect(filteredForAdmin["iban"]).toBe("DE89370400440532013000");
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
