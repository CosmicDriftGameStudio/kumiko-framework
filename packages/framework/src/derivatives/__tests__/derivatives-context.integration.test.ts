// Proves ctx.derivatives actually arrives on BOTH context-building paths
// this cut wires it into: the HTTP write-handler path (dispatch-shared.ts
// buildHandlerContext) and the job path (job-runner.ts handleJob). A unit
// test on createDerivativesContext alone can't catch a forgotten wiring
// point — this is that test.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DerivativeRendererPlugin } from "@cosmicdrift/kumiko-types/derivatives-types";
import { z } from "zod";
import { defineFeature, EXT_DERIVATIVE_RENDERER } from "../../engine";
import { InternalError, NotFoundError, writeFailure } from "../../errors";
import { createFilesFeature } from "../../files/feature";
import { createInMemoryFileProvider } from "../../files/in-memory-provider";
import { createTestUser, setupTestStack, type TestStack, testTenantId } from "../../stack";
import { buildMultipartBody, patchFileInstanceofForBunTest, waitFor } from "../../testing";

const fakeRender: DerivativeRendererPlugin["render"] = async () => new Uint8Array([9, 9, 9]);

const jobResults: Array<{ storageKey: string; mimeType: string; rendered: boolean }> = [];

const derivativesTestFeature = defineFeature("derivativestest", (r) => {
  r.extendsRegistrar(EXT_DERIVATIVE_RENDERER, { onRegister: () => {} });
  r.useExtension(EXT_DERIVATIVE_RENDERER, "image/*", { render: fakeRender });

  r.writeHandler(
    "make-variant",
    z.object({ fileRefId: z.string() }),
    async (event, ctx) => {
      if (!ctx.derivatives) {
        return writeFailure(
          new InternalError({ message: "no ctx.derivatives on write-handler ctx" }),
        );
      }
      const result = await ctx.derivatives.variant(
        event.payload.fileRefId,
        { maxEdge: 100 },
        "thumb",
      );
      return { isSuccess: true as const, data: result };
    },
    { access: { openToAll: true } },
  );

  // Catches the error INSIDE the handler (not via HTTP serialization) so the
  // test can assert `instanceof` on the concrete error class — the wire
  // response only carries the serialized WireErrorInfo, which loses that.
  r.writeHandler(
    "probe-typed-error",
    z.object({ fileRefId: z.string() }),
    async (event, ctx) => {
      if (!ctx.derivatives) {
        return writeFailure(
          new InternalError({ message: "no ctx.derivatives on write-handler ctx" }),
        );
      }
      try {
        await ctx.derivatives.variant(event.payload.fileRefId, { maxEdge: 100 }, "thumb");
        return { isSuccess: true as const, data: { threw: false } };
      } catch (err) {
        return {
          isSuccess: true as const,
          data: {
            threw: true,
            isNotFoundError: err instanceof NotFoundError,
            notFoundHttpStatus: err instanceof NotFoundError ? err.httpStatus : undefined,
            isInternalError: err instanceof InternalError,
            internalHttpStatus: err instanceof InternalError ? err.httpStatus : undefined,
          },
        };
      }
    },
    { access: { openToAll: true } },
  );

  r.job("record", { trigger: { manual: true }, runIn: "worker" }, async (payload, ctx) => {
    const fileRefId = (payload as { fileRefId: string }).fileRefId;
    if (!ctx.derivatives) {
      throw new Error("no ctx.derivatives on job ctx");
    }
    const result = await ctx.derivatives.variant(fileRefId, { maxEdge: 200 }, "card");
    jobResults.push(result);
  });
});

let stack: TestStack;
const tenantId = testTenantId(1);
const user = createTestUser({ id: 1, tenantId, roles: ["Admin"] });
const otherTenantId = testTenantId(2);
const otherTenantUser = createTestUser({ id: 10, tenantId: otherTenantId, roles: ["Admin"] });

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), derivativesTestFeature],
    files: { storageProvider: createInMemoryFileProvider() },
    jobs: { consumerLane: "worker" },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

async function uploadFile(
  asUser = user,
  file = new File([Buffer.from([1, 2, 3])], "photo.jpg", { type: "image/jpeg" }),
): Promise<string> {
  const token = await stack.jwt.sign(asUser);
  const fd = new FormData();
  fd.append("file", file);
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: string };
  return json.id;
}

describe("ctx.derivatives wiring — HTTP write-handler path", () => {
  test("a real write-handler sees ctx.derivatives and variant() returns a storage key", async () => {
    const fileId = await uploadFile();

    const result = await stack.http.writeOk<{
      storageKey: string;
      mimeType: string;
      rendered: boolean;
    }>("derivativestest:write:make-variant", { fileRefId: fileId }, user);

    expect(result.storageKey).toContain("thumb-");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.rendered).toBe(true);
  });
});

describe("ctx.derivatives wiring — job path", () => {
  test("a job handler sees ctx.derivatives and variant() returns a storage key", async () => {
    jobResults.length = 0;
    const fileId = await uploadFile();

    // handleJob resolves tenant scope from payload.tenantId (falls back to
    // SYSTEM_TENANT_ID otherwise) — without it the derivatives lookup can't
    // find the file uploaded under the test tenant.
    await stack.jobRunner?.dispatch("derivativestest:job:record", { fileRefId: fileId, tenantId });

    await waitFor(() => {
      expect(jobResults.length).toBeGreaterThan(0);
    });
    expect(jobResults[0]?.storageKey).toContain("card-");
    expect(jobResults[0]?.rendered).toBe(true);
  });
});

// variant() filters on `id`, `tenantId`, and `isDeleted` — a unit test can't
// tell a real Postgres query from a stub that ignores those filters, so
// these three run against the real DB via setupTestStack.
describe("ctx.derivatives — the mandatory id/tenant/isDeleted filters", () => {
  test("an unknown fileRefId throws", async () => {
    const err = await stack.http.writeErr(
      "derivativestest:write:make-variant",
      { fileRefId: "00000000-0000-4000-8000-999999999999" },
      user,
    );
    expect(err.httpStatus).toBe(404);
  });

  test("a soft-deleted fileRef throws", async () => {
    const fileId = await uploadFile();
    const token = await stack.jwt.sign(user);
    const deleteRes = await stack.app.request(`/api/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteRes.status).toBe(200);

    const err = await stack.http.writeErr(
      "derivativestest:write:make-variant",
      { fileRefId: fileId },
      user,
    );
    expect(err.httpStatus).toBe(404);
  });

  test("a fileRef uploaded under a different tenant is not resolvable", async () => {
    const foreignFileId = await uploadFile(otherTenantUser);

    const err = await stack.http.writeErr(
      "derivativestest:write:make-variant",
      { fileRefId: foreignFileId },
      user,
    );
    expect(err.httpStatus).toBe(404);
  });
});

describe("ctx.derivatives — typed errors from variant()", () => {
  test("an unknown fileRefId throws NotFoundError with httpStatus 404", async () => {
    const result = await stack.http.writeOk<{
      threw: boolean;
      isNotFoundError: boolean;
      notFoundHttpStatus?: number;
    }>(
      "derivativestest:write:probe-typed-error",
      { fileRefId: "00000000-0000-4000-8000-999999999999" },
      user,
    );
    expect(result.threw).toBe(true);
    expect(result.isNotFoundError).toBe(true);
    expect(result.notFoundHttpStatus).toBe(404);
  });

  test("no renderer registered for the mimeType throws InternalError with httpStatus 500", async () => {
    const fileId = await uploadFile(
      user,
      new File([Buffer.from([1, 2, 3])], "doc.pdf", { type: "application/pdf" }),
    );

    const result = await stack.http.writeOk<{
      threw: boolean;
      isInternalError: boolean;
      internalHttpStatus?: number;
    }>("derivativestest:write:probe-typed-error", { fileRefId: fileId }, user);
    expect(result.threw).toBe(true);
    expect(result.isInternalError).toBe(true);
    expect(result.internalHttpStatus).toBe(500);
  });
});
