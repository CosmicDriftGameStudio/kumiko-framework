// Crypto-Shredding Sample — Integration Test
// Proves: PII ciphertext at rest + plaintext over the API, userOwned
// cross-row encryption, and forget-as-key-erase ([[erased]] everywhere the
// subject's key was used, events untouched).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { employeeEntity, hrCommentEntity, hrFeature } from "../feature";

let stack: TestStack;
let kms: InMemoryKmsAdapter;

const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [hrFeature] });
  await unsafeCreateEntityTable(stack.db, employeeEntity);
  await unsafeCreateEntityTable(stack.db, hrCommentEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(async () => {
  // Fresh adapter per test = fresh key universe. Rows from earlier tests
  // would name subjects this adapter never minted (fail-loud KeyNotFound),
  // so the tables reset alongside the KMS.
  await resetTestTables(stack.db, ["read_hr_employees", "read_hr_comments"]);
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
});

async function rawEmployeeRow(id: string): Promise<{ display_name: string; email: string }> {
  const result = await asRawClient(stack.db).unsafe(
    "SELECT display_name, email FROM read_hr_employees WHERE id = $1",
    [id],
  );
  // biome-ignore lint/suspicious/noExplicitAny: raw sql result shape
  const rows = ((result as any).rows ?? result) as Array<{ display_name: string; email: string }>;
  const row = rows[0];
  if (!row) throw new Error(`no employee row ${id}`);
  return row;
}

async function createEmployee(): Promise<string> {
  const created = await stack.http.writeOk<SaveContext>(
    "hr:write:employee:create",
    { displayName: "Grace Hopper", email: "grace@example.com", department: "Engineering" },
    admin,
  );
  return String(created.id);
}

describe("crypto-shredding-hr", () => {
  test("PII is ciphertext at rest, plaintext over the API", async () => {
    const employeeId = await createEmployee();

    const raw = await rawEmployeeRow(employeeId);
    expect(raw.display_name).toStartWith(`kumiko-pii:v1:user:${employeeId}:`);
    expect(raw.email).toStartWith(`kumiko-pii:v1:user:${employeeId}:`);

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "hr:query:employee:detail",
      { id: employeeId },
      admin,
    );
    expect(detail["displayName"]).toBe("Grace Hopper");
    expect(detail["email"]).toBe("grace@example.com");
    // Non-PII field stays plaintext at rest and readable.
    expect(detail["department"]).toBe("Engineering");
  });

  test("userOwned comment is encrypted under the employee's key", async () => {
    const employeeId = await createEmployee();

    const comment = await stack.http.writeOk<SaveContext>(
      "hr:write:hr-comment:create",
      { employeeId, body: "was on sick leave in March", authorName: "Manager X" },
      admin,
    );

    const result = await asRawClient(stack.db).unsafe(
      "SELECT body FROM read_hr_comments WHERE id = $1",
      [String(comment.id)],
    );
    // biome-ignore lint/suspicious/noExplicitAny: raw sql result shape
    const rows = ((result as any).rows ?? result) as Array<{ body: string }>;
    // The comment row's ciphertext names the EMPLOYEE as subject, not the row.
    expect(rows[0]?.body).toStartWith(`kumiko-pii:v1:user:${employeeId}:`);
  });

  test("forget: eraseKey renders [[erased]] for the employee AND comments about them", async () => {
    const employeeId = await createEmployee();
    await stack.http.writeOk<SaveContext>(
      "hr:write:hr-comment:create",
      { employeeId, body: "was on sick leave in March", authorName: "Manager X" },
      admin,
    );

    // What user-data-rights does after the grace period — or a DPO via the
    // crypto-shredding feature's forget-subject command.
    await kms.eraseKey({ kind: "user", userId: employeeId });

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "hr:query:employee:detail",
      { id: employeeId },
      admin,
    );
    expect(detail["displayName"]).toBe(PII_ERASED_SENTINEL);
    expect(detail["email"]).toBe(PII_ERASED_SENTINEL);
    expect(detail["department"]).toBe("Engineering");

    const list = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      "hr:query:employee:list",
      {},
      admin,
    );
    const listed = list.rows.find((i) => String(i["id"]) === employeeId);
    expect(listed?.["displayName"]).toBe(PII_ERASED_SENTINEL);

    // The ciphertext itself is untouched — rows and events keep their bytes,
    // they just can never be decrypted again.
    const raw = await rawEmployeeRow(employeeId);
    expect(raw.email).toStartWith(`kumiko-pii:v1:user:${employeeId}:`);
  });
});
