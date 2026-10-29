// Inspection Checklist Sample: Integration Test (photos in a row, create-from-plan)
// Proves, through real HTTP: pending upload with `subField`, binding under the embedded
// field name, read access, tenant isolation, disposal and copying rows from a plan.

import { describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import {
  admin,
  CREATE_FROM_PLAN,
  otherTenantAdmin,
  PLAN_CREATE,
  PROTOCOL_CREATE,
  PROTOCOL_UPDATE,
  type Row,
  useInspectionStack,
  viewer,
} from "./inspection-test-kit";

const kit = useInspectionStack();
const { upload, pendingPhoto, fileStatus, createProtocol, checkpointsOf } = kit;

describe("photos inside a row", () => {
  test("a pending upload is bound to the protocol under the top-level field name", async () => {
    const photo = await pendingPhoto();
    const created = await createProtocol({
      checkpoints: [
        { label: "Guard", kind: "check", result: "not_ok", finding: "Cracked", photos: [photo] },
      ],
    });

    const [ref] = await selectMany(kit.stack.db, fileRefsTable, { id: photo });
    expect(ref).toMatchObject({
      entityType: "inspection-protocol",
      entityId: created.id,
      fieldName: "checkpoints",
    });
  });

  test("reads: owner 200, other tenant 404, same tenant without read access denied", async () => {
    const photo = await pendingPhoto();
    await createProtocol({
      checkpoints: [
        { label: "Guard", kind: "check", result: "not_ok", finding: "Cracked", photos: [photo] },
      ],
    });
    expect(await fileStatus(photo, admin)).toBe(200);
    expect(await fileStatus(photo, otherTenantAdmin)).toBe(404);
    expect(await fileStatus(photo, viewer)).toBe(404);
  });

  test("an upload against an existing record binds the file at once", async () => {
    const created = await createProtocol({ checkpoints: [{ label: "Guard", kind: "check" }] });
    const { status, id } = await upload(admin, {
      entityId: created.id,
      fieldName: "checkpoints",
      subField: "photos",
    });
    expect(status).toBe(201);
    const [ref] = await selectMany(kit.stack.db, fileRefsTable, { id });
    expect(ref).toMatchObject({ entityId: created.id, fieldName: "checkpoints" });
  });

  test("file ids from another tenant or another protocol are rejected", async () => {
    const foreign = await pendingPhoto(otherTenantAdmin);
    const row = (photo: string): Row => ({
      label: "Guard",
      kind: "check",
      result: "not_ok",
      finding: "Cracked",
      photos: [photo],
    });
    const foreignTenant = await kit.stack.http.writeErr(
      PROTOCOL_CREATE,
      { checkpoints: [row(foreign)] },
      admin,
    );
    expect([foreignTenant.httpStatus, foreignTenant.code]).toEqual([400, "validation_error"]);

    const own = await pendingPhoto();
    await createProtocol({ checkpoints: [row(own)] });
    const otherProtocol = await kit.stack.http.writeErr(
      PROTOCOL_CREATE,
      { checkpoints: [row(own)] },
      admin,
    );
    expect([otherProtocol.httpStatus, otherProtocol.code]).toEqual([400, "validation_error"]);
  });

  test("removing a photo from a row disposes its file", async () => {
    const keep = await pendingPhoto();
    const drop = await pendingPhoto();
    const row = (photos: string[]): Row => ({
      label: "Guard",
      kind: "check",
      result: "not_ok",
      finding: "Cracked",
      photos,
    });
    const created = await createProtocol({ checkpoints: [row([keep, drop])] });

    await kit.stack.http.writeOk(
      PROTOCOL_UPDATE,
      { id: created.id, version: 1, changes: { checkpoints: [row([keep])] } },
      admin,
    );

    expect(await fileStatus(keep)).toBe(200);
    expect(await fileStatus(drop)).toBe(404);
  });

  test("a subField that is not a file sub-field or not a plain name is a 400", async () => {
    for (const subField of ["label", "a.b", "../x"]) {
      const { status } = await upload(admin, { fieldName: "checkpoints", subField });
      expect(status).toBe(400);
    }
  });
});

describe("create-from-plan", () => {
  test("copies label, kind and limits and leaves the result empty", async () => {
    const plan = await kit.stack.http.writeOk<{ id: string }>(
      PLAN_CREATE,
      {
        name: "Monthly pump check",
        checkpoints: [
          { label: "Guard fitted", kind: "check" },
          { label: "Pressure", kind: "measurement", min: 180, max: 200 },
        ],
      },
      admin,
    );

    const created = await kit.stack.http.writeOk<{ id: string }>(
      CREATE_FROM_PLAN,
      { planId: plan.id },
      admin,
    );

    expect(await checkpointsOf(created.id)).toEqual([
      { label: "Guard fitted", kind: "check" },
      { label: "Pressure", kind: "measurement", min: 180, max: 200 },
    ]);
  });
});
