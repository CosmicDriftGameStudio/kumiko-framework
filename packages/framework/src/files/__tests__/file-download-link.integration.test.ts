// Signed download links over real HTTP. No anonymousAccess on the stack: the link route must be
// reachable without a session on its own, through the public-path bypass.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMultipartBody,
  createManualClock,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../engine/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { createFilesFeature } from "../feature.ts";
import { createLocalProvider } from "../local-provider.ts";

const FILE_BYTES = new TextEncoder().encode("signed link probe, plain text content");
const LINK_QUERY = "probe:query:file-link";

const tenant = testTenantId(1);
const user = createTestUser({ id: 1, tenantId: tenant, roles: ["Admin"] });
const clock = createManualClock(Temporal.Now.instant());

const probeFeature = defineFeature("probe", (r) => {
  r.queryHandler({
    name: "file-link",
    schema: z.object({ fileRefId: z.string(), expiresInSeconds: z.number().optional() }),
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      const links = ctx.services.fileDownloadLinks;
      if (!links) throw new Error("ctx.services.fileDownloadLinks is not wired");
      return links.issue(event.payload.fileRefId, {
        ...(event.payload.expiresInSeconds !== undefined && {
          expiresInSeconds: event.payload.expiresInSeconds,
        }),
      });
    },
  });
});

let stack: TestStack;
let storagePath: string;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  storagePath = await mkdtemp(join(tmpdir(), "kumiko-download-link-"));
  stack = await setupTestStack({
    features: [createFilesFeature(), probeFeature],
    files: { storageProvider: createLocalProvider(storagePath) },
    extraContext: { clock },
  });
});

afterAll(async () => {
  await stack.cleanup();
  await rm(storagePath, { recursive: true, force: true });
});

async function uploadAsUser(): Promise<string> {
  const token = await stack.jwt.sign(user);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(FILE_BYTES)], "probe.txt", { type: "text/plain" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function issueLink(fileRefId: string): Promise<string> {
  const link = await stack.http.queryOk<{ path: string }>(LINK_QUERY, { fileRefId }, user);
  return link.path;
}

describe("signed file download link", () => {
  test("streams the file without any credentials and forbids caching", async () => {
    clock.set(Temporal.Now.instant());
    const path = await issueLink(await uploadAsUser());

    const res = await stack.app.request(path);

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(FILE_BYTES);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("a deeper path under the link prefix keeps the session guard", async () => {
    expect((await stack.app.request("/api/files/link/variant/thumb")).status).toBe(401);
  });

  test("a token with a changed last character answers 404", async () => {
    clock.set(Temporal.Now.instant());
    const path = await issueLink(await uploadAsUser());
    const tampered = path.slice(0, -1) + (path.endsWith("A") ? "B" : "A");

    expect((await stack.app.request(tampered)).status).toBe(404);
  });

  test("the link answers 404 after it has expired", async () => {
    const now = Temporal.Now.instant();
    clock.set(now);
    const path = await issueLink(await uploadAsUser());

    clock.set(now.add({ seconds: 901 }));

    expect((await stack.app.request(path)).status).toBe(404);
  });

  test("a token carrying another tenant with the same signature answers 404", async () => {
    clock.set(Temporal.Now.instant());
    const path = await issueLink(await uploadAsUser());
    const parts = path.split("/");
    const tokenParts = (parts.pop() ?? "").split(".");
    tokenParts[0] = testTenantId(2);
    const forged = [...parts, tokenParts.join(".")].join("/");

    expect((await stack.app.request(forged)).status).toBe(404);
  });

  test("the link answers 404 once the file is deleted", async () => {
    clock.set(Temporal.Now.instant());
    const fileId = await uploadAsUser();
    const path = await issueLink(fileId);
    expect((await stack.app.request(path)).status).toBe(200);

    const token = await stack.jwt.sign(user);
    const deleted = await stack.app.request(`/api/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleted.status).toBe(200);

    expect((await stack.app.request(path)).status).toBe(404);
  });
});
