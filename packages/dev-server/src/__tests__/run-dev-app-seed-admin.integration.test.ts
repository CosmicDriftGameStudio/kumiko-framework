// A stack seed receives the real seeded admin (not TestUsers.admin): its
// session user must be accepted by the real stack, so demo data seeded as that
// admin is visible to the same account after login.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import * as jose from "jose";
import { composeRendererStack } from "../compose-stacks.ts";
import type { KumikoServerHandle } from "../create-kumiko-server.ts";
import { runDevApp, type SeedFn } from "../run-dev-app.ts";
import { createDemoTasksFeature } from "../scaffold-demo-tasks.ts";
import {
  SEED_ADMIN as ADMIN,
  SEED_ADMIN_JWT_SECRET,
  SEED_ADMIN_TENANT_ID as TENANT_ID,
} from "./fixtures/seed-admin.ts";

let handle: KumikoServerHandle | undefined;
const savedJwtSecret = process.env["JWT_SECRET"];

beforeEach(() => {
  process.env["JWT_SECRET"] = SEED_ADMIN_JWT_SECRET;
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  if (savedJwtSecret === undefined) delete process.env["JWT_SECRET"];
  else process.env["JWT_SECRET"] = savedJwtSecret;
});

describe("runDevApp — stack seeds get the seeded admin", () => {
  test("tasks created by the seed are listed for the real admin", async () => {
    let seededAs: SessionUser | undefined;
    const seed: SeedFn = async (stack, { admin }) => {
      if (admin === undefined) throw new Error("expected a seeded admin");
      seededAs = admin;
      await stack.http.write(
        "tasks:write:task:create",
        { title: "Welcome", status: "todo", priority: 1, isUrgent: false },
        admin,
      );
    };
    handle = await runDevApp({
      features: [createDemoTasksFeature(), ...composeRendererStack()],
      port: 0,
      auth: { admin: ADMIN },
      seeds: [seed],
    });

    const login = await handle.stack.http.raw("POST", "/api/auth/login", {
      email: ADMIN.email,
      password: ADMIN.password,
    });
    expect(login.status).toBe(200);
    const { token } = (await login.json()) as { token: string };
    expect(seededAs?.id).toBe(jose.decodeJwt(token).sub);
    expect(seededAs?.tenantId).toBe(TENANT_ID);

    const listed = await handle.stack.http.queryOk<{ rows: { title: string }[] }>(
      "tasks:query:task:list",
      {},
      seededAs!,
    );
    expect(listed.rows.map((row) => row.title)).toEqual(["Welcome"]);
  });

  test("without auth the seed gets no admin", async () => {
    let received: unknown = "unset";
    handle = await runDevApp({
      features: [createDemoTasksFeature(), ...composeRendererStack()],
      port: 0,
      seeds: [
        async (_stack, context) => {
          received = context.admin;
        },
      ],
    });
    expect(received).toBeUndefined();
  });
});
