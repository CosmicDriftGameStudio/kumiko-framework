// Inspection Checklist Sample: Integration Test (rules of single cells on save)
// Proves, through real HTTP: a cell's write access is enforced when the record is saved, and a
// file only lands in a file cell whose accept list it fits.

import { describe, expect, test } from "bun:test";
import {
  admin,
  inspector,
  PROTOCOL_CREATE,
  PROTOCOL_UPDATE,
  type Row,
  useInspectionStack,
} from "./inspection-test-kit";

const kit = useInspectionStack();

// The same denial a top-level field with a write rule gets.
const OWNERSHIP_DENIED = [422, "errors.ownershipDenied"];

const check = (extra: Row = {}): Row => ({ label: "Guard", kind: "check", ...extra });

describe("write access of a single cell", () => {
  test("a user without the role cannot set the cell, on create or update", async () => {
    const created = await kit.stack.http.writeErr(
      PROTOCOL_CREATE,
      { checkpoints: [check({ approvedBy: "Me" })] },
      inspector,
    );
    expect([created.httpStatus, created.i18nKey]).toEqual(OWNERSHIP_DENIED);

    const protocol = await kit.createProtocol({ checkpoints: [check()] }, inspector);
    const updated = await kit.stack.http.writeErr(
      PROTOCOL_UPDATE,
      { id: protocol.id, version: 1, changes: { checkpoints: [check({ approvedBy: "Me" })] } },
      inspector,
    );
    expect([updated.httpStatus, updated.i18nKey]).toEqual(OWNERSHIP_DENIED);
    expect(await kit.checkpointsOf(protocol.id)).toEqual([check()]);
  });

  test("the same user may save rows that leave the cell as it is", async () => {
    const protocol = await kit.createProtocol({ checkpoints: [check({ approvedBy: "Boss" })] });
    await kit.stack.http.writeOk(
      PROTOCOL_UPDATE,
      {
        id: protocol.id,
        version: 1,
        changes: { checkpoints: [check({ approvedBy: "Boss", label: "Guard fitted" })] },
      },
      inspector,
    );
    expect(await kit.checkpointsOf(protocol.id)).toEqual([
      check({ approvedBy: "Boss", label: "Guard fitted" }),
    ]);
  });

  test("changing or clearing the cell on an existing row is denied, removing the row too", async () => {
    const protocol = await kit.createProtocol({ checkpoints: [check({ approvedBy: "Boss" })] });
    for (const checkpoints of [[check({ approvedBy: "Me" })], [check()], []]) {
      const denied = await kit.stack.http.writeErr(
        PROTOCOL_UPDATE,
        { id: protocol.id, version: 1, changes: { checkpoints } },
        inspector,
      );
      expect([denied.httpStatus, denied.i18nKey]).toEqual(OWNERSHIP_DENIED);
    }
    await kit.stack.http.writeOk(
      PROTOCOL_UPDATE,
      { id: protocol.id, version: 1, changes: { checkpoints: [check({ approvedBy: "Me" })] } },
      admin,
    );
  });
});

describe("a file only lands in a cell it fits", () => {
  test("a pdf uploaded to the loose cell is rejected in the photos cell", async () => {
    const pdf = await kit.pendingDocument();
    const denied = await kit.stack.http.writeErr(
      PROTOCOL_CREATE,
      {
        checkpoints: [
          check({ result: "not_ok", finding: "Cracked", photos: [pdf], documents: [pdf] }),
        ],
      },
      admin,
    );
    expect([denied.httpStatus, denied.code]).toEqual([422, "unprocessable"]);
  });

  test("the same pdf is accepted where it was uploaded", async () => {
    const pdf = await kit.pendingDocument();
    const created = await kit.createProtocol({ checkpoints: [check({ documents: [pdf] })] });
    expect(await kit.checkpointsOf(created.id)).toEqual([check({ documents: [pdf] })]);
  });

  test("moving a stored pdf from the documents cell to the photos cell is rejected", async () => {
    const pdf = await kit.pendingDocument();
    const created = await kit.createProtocol({ checkpoints: [check({ documents: [pdf] })] });
    const denied = await kit.stack.http.writeErr(
      PROTOCOL_UPDATE,
      {
        id: created.id,
        version: 1,
        changes: {
          checkpoints: [check({ result: "not_ok", finding: "Cracked", photos: [pdf] })],
        },
      },
      admin,
    );
    expect([denied.httpStatus, denied.code]).toEqual([422, "unprocessable"]);
  });
});
