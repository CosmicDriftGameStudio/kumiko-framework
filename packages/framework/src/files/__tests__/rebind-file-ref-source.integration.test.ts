// What rebindFileRef asks of the record the file is taken from: write access like a save of it,
// an update handler unless the system job moves it, and a lock that holds against a concurrent one.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { executeRawQuery } from "../../db/queries/raw-sql.ts";
import {
  armArchiveHold,
  createContact,
  ownerOf,
  REBIND,
  REBIND_JOB,
  setupRebindStack,
  tenant,
  uploadBoundFile,
  users,
} from "./rebind-file-ref-fixture.ts";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupRebindStack();
});
afterAll(() => stack.cleanup());

async function writersBlockedOnRowLock(): Promise<number> {
  const rows = await executeRawQuery<{ count: number }>(
    stack.db,
    `SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND wait_event = 'transactionid'`,
  );
  return rows[0]?.count ?? 0;
}

describe("rebindFileRef source checks", () => {
  test("a caller who can read the file and write the target, but not the source, is refused", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile(stack);
    const contactId = await createContact(stack);

    const refused = await stack.http.writeErr(
      REBIND,
      { fileRefId, uploadId, contactId },
      users.uploadReaderContactEditor,
    );
    expect(refused.code).toBe("access_denied");
    expect(refused.message).toContain("source upload.file");
    expect((await ownerOf(stack, fileRefId)).entityId).toBe(uploadId);
  });

  test("a source without update handler gives its file only to the system job", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile(stack, { source: "inbox" });
    const contactId = await createContact(stack);

    const refused = await stack.http.writeErr(
      REBIND,
      { fileRefId, source: "inbox", uploadId, contactId },
      users.clerk,
    );
    expect(refused.code).toBe("access_denied");
    expect(refused.message).toContain("source inbox.file");
    expect((await ownerOf(stack, fileRefId)).entityId).toBe(uploadId);

    await stack.jobRunner?.dispatch(REBIND_JOB, {
      tenantId: tenant,
      fileRefId,
      source: "inbox",
      uploadId,
      contactId,
    });
    await stack.drainJobs();
    expect((await ownerOf(stack, fileRefId)).entityId).toBe(contactId);
  });

  test("a lock on the source committed while the rebind runs is honoured", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile(stack);
    const contactId = await createContact(stack);
    const upload = await stack.http.queryOk<{ version: number }>(
      "rebind-probe:query:upload:detail",
      { id: uploadId },
      users.clerk,
    );

    const hold = armArchiveHold();
    const archiving = stack.http.write(
      "rebind-probe:write:upload:update",
      { id: uploadId, version: upload.version, changes: { isArchived: true } },
      users.clerk,
    );
    await hold.written();
    const rebinding = stack.http.write(REBIND, { fileRefId, uploadId, contactId }, users.clerk);
    // Without the row lock the rebind would read the uncommitted lock as absent and finish here.
    try {
      await waitFor(async () => (await writersBlockedOnRowLock()) > 0, {
        delays: Array.from({ length: 40 }, () => 50),
      });
    } finally {
      hold.commit();
    }

    expect((await archiving).status).toBe(200);
    const refused = await rebinding;
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "record_locked",
    );
    expect((await ownerOf(stack, fileRefId)).entityId).toBe(uploadId);
  });
});
