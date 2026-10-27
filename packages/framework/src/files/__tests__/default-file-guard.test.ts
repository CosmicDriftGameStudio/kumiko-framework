import { describe, expect, test } from "bun:test";
import { createDefaultGuard } from "../default-file-guard.ts";
import type { FileAccessGuard } from "../file-routes.ts";

type GuardArgs = Parameters<FileAccessGuard>[0];

const RECORD_ONLY = new Set(["mail"]);
const canReadRecord = async ({ user }: { user: { id: string } }) => user.id === "reader";
const guard = createDefaultGuard(["Admin"], canReadRecord, [], RECORD_ONLY);

function request(entityType: string, user: { id: string; roles: string[] }): GuardArgs {
  return {
    fileRef: { entityType, entityId: "rec-1", insertedById: "system-ish" },
    user,
    operation: "read",
  } as unknown as GuardArgs;
}

describe("default file guard: record-only entity types", () => {
  test("a privileged role reads files of an ordinary entity type", async () => {
    expect(await guard(request("invoice", { id: "boss", roles: ["Admin"] }))).toBe("allow");
  });

  test("a privileged role gets no shortcut on a record-only type, the record decides", async () => {
    expect(await guard(request("mail", { id: "boss", roles: ["Admin"] }))).toBe("deny");
    expect(await guard(request("mail", { id: "reader", roles: [] }))).toBe("allow");
  });
});
