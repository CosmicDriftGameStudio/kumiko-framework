import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createDbConnection } from "../connection.ts";
import { createApplicationRole } from "../queries/test-stack.ts";
import { asRawClient } from "../query.ts";

const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const ROLE = `kumiko_role_pw_${Date.now().toString(36)}`;

function urlAs(role: string, password: string): string {
  const url = new URL(ADMIN_URL);
  url.username = role;
  url.password = password;
  return url.toString();
}

describe("createApplicationRole", () => {
  const admin = createDbConnection({ url: ADMIN_URL, maxConnections: 1, rowLevelSecurity: "off" });

  afterAll(async () => {
    await asRawClient(admin.db).unsafe(`DROP ROLE IF EXISTS "${ROLE}"`);
    await admin.close();
  });

  test("an existing role with another password is realigned to the requested one", async () => {
    await createApplicationRole(admin.db, ROLE, "first-password");
    await createApplicationRole(admin.db, ROLE, "second-password");

    const asRole = new SQL(urlAs(ROLE, "second-password"));
    try {
      const rows = await asRole.unsafe(`SELECT current_user AS who`);
      expect(rows[0]?.who).toBe(ROLE);
    } finally {
      await asRole.close();
    }
  });
});
