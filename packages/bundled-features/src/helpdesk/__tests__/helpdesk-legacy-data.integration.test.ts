import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";

import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { upsertPreference } from "../../delivery/upsert-preference.ts";
import { HELPDESK_FORMER_NOTIFICATION_NAMES } from "../web/constants.ts";
import { mailsTo, postSubmit, seedAdmin, submitBody } from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
} from "./helpdesk-test-stack.ts";

let ctx: HelpdeskTestStack;
let admin: SessionUser;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createHelpdeskTestStack();
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetHelpdeskTestState(ctx);
  admin = await seedAdmin(ctx.stack, "admin1@example.com");
});

describe("helpdesk keeps notification preferences stored under the contact names", () => {
  test("a former-name preference suppresses the new-request mail for that admin only", async () => {
    await seedAdmin(ctx.stack, "admin2@example.com");
    const [formerNewRequestName] = HELPDESK_FORMER_NOTIFICATION_NAMES.newRequest;

    const stored = await upsertPreference(
      createTenantDb({ db: ctx.stack.db, tenantId: admin.tenantId }),
      admin,
      {
        tenantId: admin.tenantId,
        userId: admin.id,
        notificationType: formerNewRequestName,
        channel: "email",
        enabled: false,
      },
    );
    expect(stored.isSuccess).toBe(true);

    const res = await postSubmit(ctx.stack, await submitBody(ctx.stack));
    expect(res.status).toBe(200);

    expect(mailsTo("admin1@example.com")).toHaveLength(0);
    expect(mailsTo("admin2@example.com")).toHaveLength(1);
  });
});
