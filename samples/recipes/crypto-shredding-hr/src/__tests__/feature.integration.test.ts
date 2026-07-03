// Crypto-Shredding Sample — Integration Test
// Proves: PII ciphertext at rest + plaintext over the API, userOwned
// cross-row encryption, and forget-as-key-erase ([[erased]] everywhere the
// subject's key was used, events untouched).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import { buildEntityTable, nullBlindIndexesForSubject } from "@cosmicdrift/kumiko-framework/db";
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
  resetBlindIndexKeyForTests();
});

beforeEach(async () => {
  // Fresh adapter per test = fresh key universe. Rows from earlier tests
  // would name subjects this adapter never minted (fail-loud KeyNotFound),
  // so the tables reset alongside the KMS.
  await resetTestTables(stack.db, ["read_hr_employees", "read_hr_comments"]);
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
  // Blind-index key: what runProdApp({ blindIndexKey }) wires in production.
  configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
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

describe("crypto-shredding-hr — blind-index lookups (#818)", () => {
  const employeeTable = buildEntityTable("employee", employeeEntity);

  test("equality lookup by email works on the encrypted column — until the key is erased", async () => {
    const employeeId = await createEmployee();

    // The email column holds ciphertext, yet an equality lookup — what a
    // login or dedup check does — still finds the row: the query compiler
    // rewrites `email = $1` to `(email = $1 OR email_bidx = hmac($1))`.
    const hit = await fetchOne<Record<string, unknown>>(stack.db, employeeTable, {
      email: "grace@example.com",
    });
    expect(String(hit?.["id"])).toBe(employeeId);

    // Forget: erase the key AND null the blind index (user-data-rights does
    // both automatically after the grace period).
    await kms.eraseKey({ kind: "user", userId: employeeId });
    await nullBlindIndexesForSubject(
      stack.db,
      new Map([["hr", hrFeature]]),
      subjectIdToKey({ kind: "user", userId: employeeId }),
    );

    // The lookup value is gone with the key — no row matches anymore.
    expect(await fetchOne(stack.db, employeeTable, { email: "grace@example.com" })).toBeUndefined();
  });
});
