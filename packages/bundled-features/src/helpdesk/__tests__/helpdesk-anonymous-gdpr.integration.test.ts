import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  createTenantDb,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { seedUser } from "../../user/seeding.ts";
import { runForgetCleanup } from "../../user-data-rights/run-forget-cleanup.ts";
import { runUserExport } from "../../user-data-rights/run-user-export.ts";
import { loadRequests, postSubmit, submitBody } from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
} from "./helpdesk-test-stack.ts";

const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
const MESSAGE = "How do I export my data?";

let ctx: HelpdeskTestStack;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createHelpdeskTestStack();
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  resetPiiSubjectKmsForTests();
  await resetHelpdeskTestState(ctx);
});

async function requestUserDeletion(userId: string): Promise<void> {
  const row = await fetchOne(ctx.stack.db, userTable, { id: userId });
  if (!row) throw new Error("user missing");
  const result = await userExecutor.update(
    {
      id: userId,
      version: Number(row["version"]),
      changes: {
        status: USER_STATUS.DeletionRequested,
        gracePeriodEnd: Temporal.Now.instant().subtract({ minutes: 1 }),
      },
    },
    TestUsers.systemAdmin,
    createTenantDb({
      db: ctx.stack.db,
      tenantId: SYSTEM_TENANT_ID,
      mode: "system",
      reason: "test moves the user into the deletion grace period",
    }),
  );
  expect(result.isSuccess).toBe(true);
}

async function exportedRequestRows(userId: string): Promise<readonly unknown[]> {
  const bundle = await runUserExport({
    db: ctx.stack.db,
    registry: ctx.stack.registry,
    userId,
    now: Temporal.Now.instant(),
  });
  const snippet = bundle.tenants
    .flatMap((section) => section.entities)
    .find((entity) => entity.entity === "helpdesk-request");
  return snippet?.rows ?? [];
}

async function submitAnonymously(email: string): Promise<void> {
  const res = await postSubmit(ctx.stack, await submitBody(ctx.stack, { email }));
  expect(res.status).toBe(200);
  expect(await loadRequests(ctx.stack)).toHaveLength(1);
}

async function forgetAll(): Promise<void> {
  const result = await runForgetCleanup({
    db: ctx.stack.db,
    registry: ctx.stack.registry,
    now: Temporal.Now.instant(),
  });
  expect(result.errors).toHaveLength(0);
}

function withoutAndWithKms(run: () => Promise<void>) {
  return [
    ["without KMS", () => run()],
    [
      "with KMS and blind index",
      async () => {
        configurePiiSubjectKms(new InMemoryKmsAdapter());
        configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
        await run();
      },
    ],
  ] as const;
}

describe("helpdesk GDPR for anonymous requests matched by verified email", () => {
  for (const [label, arrange] of withoutAndWithKms(async () => {})) {
    test(`export and forget find the request ${label}`, async () => {
      await arrange();
      const email = "anon.reporter@example.com";
      await submitAnonymously(email);
      const { id } = await seedUser(ctx.stack.db, {
        email,
        displayName: "Anon Reporter",
        emailVerified: true,
      });

      expect(JSON.stringify(await exportedRequestRows(id))).toContain(MESSAGE);

      await requestUserDeletion(id);
      await forgetAll();
      expect(await loadRequests(ctx.stack)).toHaveLength(0);
    });

    test(`an unverified email matches nothing ${label}`, async () => {
      await arrange();
      const email = "unverified.reporter@example.com";
      await submitAnonymously(email);
      const { id } = await seedUser(ctx.stack.db, {
        email,
        displayName: "Not Verified",
        emailVerified: false,
      });

      expect(await exportedRequestRows(id)).toHaveLength(0);

      await requestUserDeletion(id);
      await forgetAll();
      expect(await loadRequests(ctx.stack)).toHaveLength(1);
    });
  }
});
