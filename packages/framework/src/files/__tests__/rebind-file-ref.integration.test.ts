import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import {
  createContact,
  fileStatusFor,
  ownerOf,
  REBIND,
  REBIND_JOB,
  rebindAs,
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

describe("rebindFileRef", () => {
  test("moves a bound upload onto the contact's file field, and again is a no-op", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile(stack);
    const contactId = await createContact(stack);
    expect(await ownerOf(stack, fileRefId)).toEqual({
      entityType: "upload",
      entityId: uploadId,
      fieldName: "file",
    });

    expect(await rebindAs(stack, users.clerk, { fileRefId, uploadId, contactId })).toBe("rebound");
    expect(await ownerOf(stack, fileRefId)).toEqual({
      entityType: "contact",
      entityId: contactId,
      fieldName: "doc",
    });
    expect(await rebindAs(stack, users.clerk, { fileRefId, uploadId, contactId })).toBe("rebound");
  });

  test("a system job may move the file without the caller checks", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile(stack);
    const contactId = await createContact(stack);

    await stack.jobRunner?.dispatch(REBIND_JOB, {
      tenantId: tenant,
      fileRefId,
      uploadId,
      contactId,
    });
    await stack.drainJobs();

    expect((await ownerOf(stack, fileRefId)).entityId).toBe(contactId);
  });

  test("the contact takes the file over: it saves the ref, its readers get the file, and the upload no longer disposes of it", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile(stack);
    const contactId = await createContact(stack);
    expect(await fileStatusFor(stack, users.contactEditor, fileRefId)).toBe(404);

    expect(await rebindAs(stack, users.clerk, { fileRefId, uploadId, contactId })).toBe("rebound");
    const contact = await stack.http.queryOk<{ version: number }>(
      "rebind-probe:query:contact:detail",
      { id: contactId },
      users.clerk,
    );
    await stack.http.writeOk(
      "rebind-probe:write:contact:update",
      { id: contactId, version: contact.version, changes: { doc: fileRefId } },
      users.clerk,
    );
    expect(
      await stack.http.queryOk<{ doc: string }>(
        "rebind-probe:query:contact:detail",
        { id: contactId },
        users.clerk,
      ),
    ).toMatchObject({ doc: fileRefId });
    expect(await fileStatusFor(stack, users.contactEditor, fileRefId)).toBe(200);

    const upload = await stack.http.queryOk<{ version: number }>(
      "rebind-probe:query:upload:detail",
      { id: uploadId },
      users.clerk,
    );
    const cleared = await stack.http.writeOk<{ version: number }>(
      "rebind-probe:write:upload:update",
      { id: uploadId, version: upload.version, changes: { file: null } },
      users.clerk,
    );
    await stack.http.writeOk(
      "rebind-probe:write:upload:delete",
      { id: uploadId, version: cleared.version },
      users.clerk,
    );
    expect((await ownerOf(stack, fileRefId)).entityId).toBe(contactId);
    expect(await fileStatusFor(stack, users.contactEditor, fileRefId)).toBe(200);
  });

  test("a system job cannot point the file at a record that does not exist", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile(stack);

    await stack.jobRunner?.dispatch(REBIND_JOB, {
      tenantId: tenant,
      fileRefId,
      uploadId,
      contactId: crypto.randomUUID(),
    });
    await expect(stack.drainJobs()).rejects.toThrow(/rebind-as-system/);

    expect((await ownerOf(stack, fileRefId)).entityId).toBe(uploadId);
  });

  test("another tenant's file is not found and stays where it is", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile(stack);
    const foreignContactId = await createContact(stack, users.foreignClerk);

    expect(
      await rebindAs(stack, users.foreignClerk, {
        fileRefId,
        uploadId,
        contactId: foreignContactId,
      }),
    ).toBe("not-found");
    expect((await ownerOf(stack, fileRefId)).entityId).toBe(uploadId);
  });

  test("a caller who may not write the target, or not read the file, is refused", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile(stack);
    const contactId = await createContact(stack);

    const notWritable = await stack.http.writeErr(
      REBIND,
      { fileRefId, uploadId, contactId },
      users.uploadEditor,
    );
    expect(notWritable.code).toBe("access_denied");
    expect(notWritable.message).toContain("contact.doc of");

    const notReadable = await stack.http.writeErr(
      REBIND,
      { fileRefId, uploadId, contactId },
      users.contactEditor,
    );
    expect(notReadable.code).toBe("access_denied");
    expect(notReadable.message).toContain("is not readable");

    expect((await ownerOf(stack, fileRefId)).entityId).toBe(uploadId);
  });

  test("a target field the file does not fit is refused", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile(stack);
    const contactId = await createContact(stack);

    const refused = await stack.http.writeErr(
      REBIND,
      { fileRefId, uploadId, contactId, fieldName: "photo" },
      users.clerk,
    );
    expect(refused.code).toBe("unprocessable");
    expect((await ownerOf(stack, fileRefId)).entityId).toBe(uploadId);
  });

  test("of two parallel rebinds exactly one wins and the file points at the winner", async () => {
    const { fileRefId, uploadId } = await uploadBoundFile(stack);
    const contactIds = [await createContact(stack), await createContact(stack)] as const;

    const outcomes = await Promise.all(
      contactIds.map((contactId) =>
        rebindAs(stack, users.clerk, { fileRefId, uploadId, contactId }),
      ),
    );

    expect(outcomes.filter((outcome) => outcome === "rebound")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome !== "rebound")).toMatch(/^(moved|version-conflict)$/);
    expect((await ownerOf(stack, fileRefId)).entityId).toBe(
      contactIds.at(outcomes.indexOf("rebound")),
    );
  });
});
