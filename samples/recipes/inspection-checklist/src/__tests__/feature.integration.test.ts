// Inspection Checklist Sample: Integration Test (conditional rows and derived result)
// Proves, through real HTTP: server-enforced requiredWhen on rows and top-level fields and
// the server-authoritative inRange cell.

import { describe, expect, test } from "bun:test";
import {
  admin,
  measurement,
  PROTOCOL_CREATE,
  PROTOCOL_UPDATE,
  useInspectionStack,
} from "./inspection-test-kit";

const kit = useInspectionStack();
const { pendingPhoto, createProtocol, checkpointsOf, storedResultOf } = kit;

describe("requiredWhen on rows", () => {
  test("a not_ok row without finding and photos is rejected with a path per cell", async () => {
    const error = await kit.stack.http.writeErr(
      PROTOCOL_CREATE,
      { checkpoints: [{ label: "Guard", kind: "check", result: "not_ok" }] },
      admin,
    );
    expect(error.httpStatus).toBe(400);
    expect(error.code).toBe("validation_error");
    const paths = (error.details as { fields: { path: string }[] }).fields.map((f) => f.path);
    expect(paths).toEqual(["checkpoints.0.finding", "checkpoints.0.photos"]);
  });

  test("a not_ok row with finding and photo is accepted", async () => {
    const photo = await pendingPhoto();
    const created = await createProtocol({
      checkpoints: [
        { label: "Guard", kind: "check", result: "not_ok", finding: "Cracked", photos: [photo] },
      ],
    });
    expect((await checkpointsOf(created.id))[0]).toMatchObject({
      result: "not_ok",
      finding: "Cracked",
      photos: [photo],
    });
  });
});

describe("inRange result", () => {
  test("the server derives not_ok above and ok inside the range, bounds included", async () => {
    const photo = await pendingPhoto();
    const outside = measurement(210, { finding: "Too high", photos: [photo] });
    expect(await storedResultOf(outside)).toBe("not_ok");
    expect(await storedResultOf(measurement(190))).toBe("ok");
    expect(await storedResultOf(measurement(180))).toBe("ok");
    expect(await storedResultOf(measurement(200))).toBe("ok");
  });

  test("a client-sent ok never survives a measured value outside the range", async () => {
    const photo = await pendingPhoto();
    const row = measurement(210, { result: "ok", finding: "Too high", photos: [photo] });
    expect(await storedResultOf(row)).toBe("not_ok");
  });

  test("requiredWhen sees the derived result, not the client-sent one", async () => {
    const error = await kit.stack.http.writeErr(
      PROTOCOL_CREATE,
      { checkpoints: [measurement(210, { result: "ok" })] },
      admin,
    );
    expect(error.httpStatus).toBe(400);
    const paths = (error.details as { fields: { path: string }[] }).fields.map((f) => f.path);
    expect(paths).toEqual(["checkpoints.0.finding", "checkpoints.0.photos"]);
  });

  test("a manual result on a check row is kept", async () => {
    const row = { label: "Guard", kind: "check", result: "ok" };
    expect(await storedResultOf(row)).toBe("ok");
  });
});

describe("requiredWhen on top-level fields", () => {
  test("with_condition needs a condition on create and on update", async () => {
    const onCreate = await kit.stack.http.writeErr(
      PROTOCOL_CREATE,
      { checkpoints: [], continuedOperation: "with_condition" },
      admin,
    );
    expect((onCreate.details as { fields: { path: string }[] }).fields[0]?.path).toBe("condition");

    const created = await createProtocol({ checkpoints: [], continuedOperation: "yes" });
    const onUpdate = await kit.stack.http.writeErr(
      PROTOCOL_UPDATE,
      { id: created.id, version: 1, changes: { continuedOperation: "with_condition" } },
      admin,
    );
    expect(onUpdate.httpStatus).toBe(400);
    expect((onUpdate.details as { fields: { path: string }[] }).fields[0]?.path).toBe("condition");

    await kit.stack.http.writeOk(
      PROTOCOL_UPDATE,
      {
        id: created.id,
        version: 1,
        changes: { continuedOperation: "with_condition", condition: "Daylight only" },
      },
      admin,
    );
  });

  test("an unrelated update passes when the conditional fields are unchanged", async () => {
    const created = await createProtocol({
      checkpoints: [],
      continuedOperation: "with_condition",
      condition: "Daylight only",
    });
    await kit.stack.http.writeOk(
      PROTOCOL_UPDATE,
      { id: created.id, version: 1, changes: { measuringDevice: "Gauge 7" } },
      admin,
    );
  });
});
