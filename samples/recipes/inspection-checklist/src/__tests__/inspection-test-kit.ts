import { afterAll, beforeAll, expect } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createFileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { inspectionPlanEntity } from "../entities/inspection-plan";
import { inspectionProtocolEntity } from "../entities/inspection-protocol";
import { inspectionChecklistFeature } from "../feature";

export const PROTOCOL_CREATE = "inspection-checklist:write:inspection-protocol:create";
export const PROTOCOL_UPDATE = "inspection-checklist:write:inspection-protocol:update";
export const PROTOCOL_DETAIL = "inspection-checklist:query:inspection-protocol:detail";
export const PLAN_CREATE = "inspection-checklist:write:inspection-plan:create";
export const CREATE_FROM_PLAN = "inspection-checklist:write:inspection-protocol:create-from-plan";

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(10).fill(0)]);

const tenantId = testTenantId(1);
export const admin = createTestUser({ id: 1, tenantId, roles: ["Admin"] });
export const viewer = createTestUser({ id: 2, tenantId, roles: ["Viewer"] });
export const otherTenantAdmin = createTestUser({
  id: 3,
  tenantId: testTenantId(2),
  roles: ["Admin"],
});

type User = typeof admin;
export type Row = Record<string, unknown>;
type Protocol = { readonly id: string; readonly version: number };

export function measurement(measured: number | undefined, extra: Row = {}): Row {
  return { label: "Pressure", kind: "measurement", min: 180, max: 200, measured, ...extra };
}

export function useInspectionStack() {
  let stack: TestStack;

  beforeAll(async () => {
    patchFileInstanceofForBunTest();
    stack = await setupTestStack({
      features: [
        createConfigFeature(),
        createFileFoundationFeature(),
        createFilesFeature(),
        inspectionChecklistFeature,
      ],
      files: { storageProvider: createInMemoryFileProvider() },
    });
    await unsafeCreateEntityTable(stack.db, inspectionPlanEntity, "inspection-plan");
    await unsafeCreateEntityTable(stack.db, inspectionProtocolEntity, "inspection-protocol");
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  type UploadTarget = { entityId?: string; fieldName?: string; subField?: string };

  async function upload(
    asUser: User,
    target: UploadTarget = { fieldName: "checkpoints", subField: "photos" },
  ) {
    const fd = new FormData();
    fd.append("entityType", "inspection-protocol");
    if (target.fieldName !== undefined) fd.append("fieldName", target.fieldName);
    if (target.subField !== undefined) fd.append("subField", target.subField);
    if (target.entityId !== undefined) fd.append("entityId", target.entityId);
    fd.append("file", new File([Buffer.from(JPEG_BYTES)], "pump.jpg", { type: "image/jpeg" }));
    const { body, contentType } = await buildMultipartBody(fd);
    const token = await stack.jwt.sign(asUser);
    const res = await stack.app.request("/api/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body,
    });
    const json = (await res.json()) as { id?: string };
    return { status: res.status, id: json.id ?? "" };
  }

  async function pendingPhoto(asUser: User = admin): Promise<string> {
    const { status, id } = await upload(asUser);
    expect(status).toBe(201);
    return id;
  }

  async function fileStatus(fileId: string, asUser: User = admin): Promise<number> {
    const token = await stack.jwt.sign(asUser);
    const res = await stack.app.request(`/api/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.status;
  }

  async function createProtocol(payload: Row, asUser: User = admin): Promise<Protocol> {
    return stack.http.writeOk<Protocol>(PROTOCOL_CREATE, payload, asUser);
  }

  async function checkpointsOf(id: string): Promise<Row[]> {
    const detail = await stack.http.queryOk<{ checkpoints: Row[] }>(PROTOCOL_DETAIL, { id }, admin);
    return detail.checkpoints;
  }

  async function storedResultOf(row: Row): Promise<unknown> {
    const created = await createProtocol({ checkpoints: [row] });
    return (await checkpointsOf(created.id))[0]?.["result"];
  }

  return {
    get stack() {
      return stack;
    },
    upload,
    pendingPhoto,
    fileStatus,
    createProtocol,
    checkpointsOf,
    storedResultOf,
  };
}
