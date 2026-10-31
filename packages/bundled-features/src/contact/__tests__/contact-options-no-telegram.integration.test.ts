import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { ContactHandlers, ContactQueries } from "../web/constants.ts";
import { loadRequests, mailsTo, postSubmit, seedAdmin, submitBody } from "./contact-helpers.ts";
import {
  type ContactTestStack,
  createContactTestStack,
  resetContactTestState,
} from "./contact-test-stack.ts";

let ctx: ContactTestStack;
let admin: SessionUser;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createContactTestStack({ telegram: false });
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetContactTestState(ctx);
  admin = await seedAdmin(ctx.stack, "admin1@example.com");
});

describe("contact without the telegram option", () => {
  test("registers no telegram config key and no send-test handler", async () => {
    const config = await ctx.stack.http.writeErr(
      "config:write:set",
      { key: "contact:config:telegram-chat", value: "-100123", scope: "system" },
      admin,
    );
    expect(config.httpStatus).toBeGreaterThanOrEqual(400);
    const sendTest = await ctx.stack.http.writeErr(ContactHandlers.sendTest, {}, admin);
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
      ContactQueries.requestDelivery,
      { id: String(request?.["id"]) },
      admin,
    );
    expect(delivery.rows.map((r) => r.channel)).toEqual(["email"]);
  });
});
