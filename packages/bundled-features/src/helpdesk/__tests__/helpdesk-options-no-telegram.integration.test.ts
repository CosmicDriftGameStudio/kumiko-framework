import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { HelpdeskHandlers, HelpdeskQueries } from "../web/constants.ts";
import { loadRequests, mailsTo, postSubmit, seedAdmin, submitBody } from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
} from "./helpdesk-test-stack.ts";

let ctx: HelpdeskTestStack;
let admin: SessionUser;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createHelpdeskTestStack({ telegram: false });
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetHelpdeskTestState(ctx);
  admin = await seedAdmin(ctx.stack, "admin1@example.com");
});

describe("helpdesk without the telegram option", () => {
  test("registers no telegram config key and no send-test handler", async () => {
    const config = await ctx.stack.http.writeErr(
      "config:write:set",
      { key: "helpdesk:config:telegram-chat", value: "-100123", scope: "system" },
      admin,
    );
    expect(config.httpStatus).toBeGreaterThanOrEqual(400);
    const sendTest = await ctx.stack.http.writeErr(HelpdeskHandlers.sendTest, {}, admin);
    expect(sendTest.httpStatus).toBe(404);
  });

  test("a request is mailed to the admins and never sent to Telegram", async () => {
    const res = await postSubmit(ctx.stack, await submitBody(ctx.stack));
    expect(res.status).toBe(200);
    expect(await loadRequests(ctx.stack)).toHaveLength(1);
    expect(mailsTo("admin1@example.com")).toHaveLength(1);
    expect(ctx.telegram.requests).toHaveLength(0);

    const [request] = await loadRequests(ctx.stack);
    const delivery = await ctx.stack.http.queryOk<{ rows: { channel: string }[] }>(
      HelpdeskQueries.requestDelivery,
      { id: String(request?.["id"]) },
      admin,
    );
    expect(delivery.rows.map((r) => r.channel)).toEqual(["email"]);
  });
});
