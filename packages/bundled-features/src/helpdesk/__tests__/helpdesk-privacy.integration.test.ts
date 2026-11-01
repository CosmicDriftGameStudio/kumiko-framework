import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { HelpdeskConfigKeys, HelpdeskHandlers } from "../web/constants.ts";
import {
  fetchChallenge,
  loadRequests,
  mailsTo,
  postSubmit,
  seedAdmin,
  seedReporter,
  solve,
  submitBody,
} from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  emailTransport,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
  TELEGRAM_TOKEN,
} from "./helpdesk-test-stack.ts";

const REQUEST_LINK = (id: string) => `https://admin.example.com/helpdesk/${id}`;
const SENDER = {
  name: "Zelda Fitzgerald",
  email: "zelda.fitz@example.com",
  phone: "+49 30 7654321",
  message: "Where is my invoice 4711?\nSecond line with https://evil.example/phish",
};

let ctx: HelpdeskTestStack;
let admin: SessionUser;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createHelpdeskTestStack({
    fields: { phone: "optional" },
    requestLink: REQUEST_LINK,
  });
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetHelpdeskTestState(ctx);
  admin = await seedAdmin(ctx.stack, "admin1@example.com");
  await ctx.stack.http.writeOk(
    "secrets:write:set",
    { key: "channel-telegram:secret:bot-token", value: TELEGRAM_TOKEN },
    admin,
  );
  await ctx.stack.http.writeOk(
    "config:write:set",
    { key: HelpdeskConfigKeys.telegramChat, value: "-100123", scope: "system" },
    admin,
  );
});

function expectNoPersonalData(text: string): void {
  for (const secret of [
    SENDER.name,
    SENDER.email,
    SENDER.phone,
    "Where is my invoice",
    "4711",
    "evil.example",
  ]) {
    expect(text).not.toContain(secret);
  }
}

describe("helpdesk notifications carry no personal data", () => {
  test("admin mail and Telegram name only the kind, the app and the link", async () => {
    const res = await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, { kind: "question", ...SENDER }),
    );
    expect(res.status).toBe(200);
    const [request] = await loadRequests(ctx.stack);
    const link = REQUEST_LINK(String(request?.["id"]));

    const [adminMail] = mailsTo("admin1@example.com");
    expect(adminMail).toBeDefined();
    const adminText = `${adminMail?.subject}\n${adminMail?.html}\n${adminMail?.text ?? ""}`;
    expect(adminMail?.subject).toBe("New question on Acme");
    expect(adminText).toContain(link);
    expectNoPersonalData(adminText);

    const [hit] = ctx.telegram.hitsOn(`/bot${TELEGRAM_TOKEN}/sendMessage`);
    expect(hit?.bodyText).toContain("New question on Acme");
    expect(hit?.bodyText).toContain(link);
    expectNoPersonalData(String(hit?.bodyText));
  });

  test("an admin report notifies the same way and the reporter still gets a copy", async () => {
    const reporter = await seedReporter(ctx.stack, SENDER.email);
    await ctx.stack.http.writeOk(
      HelpdeskHandlers.report,
      { kind: "bug", subject: "Invoice 4711 broken", message: SENDER.message },
      reporter,
    );
    const [adminMail] = mailsTo("admin1@example.com");
    expect(adminMail?.subject).toBe("New problem report on Acme");
    expectNoPersonalData(`${adminMail?.subject}\n${adminMail?.html}`);
    expect(adminMail?.html).not.toContain("Invoice 4711");

    const [copy] = mailsTo(SENDER.email);
    expect(copy?.html).toContain("Where is my invoice 4711?");
  });
});

describe("contact acknowledgement to a website sender", () => {
  test("repeats nothing the sender typed, so the form is no mail relay", async () => {
    await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, {
        ...SENDER,
        name: "Click https://evil.example/name now",
        message: "Visit https://evil.example/phish to claim your prize",
      }),
    );
    const [ack] = mailsTo(SENDER.email);
    expect(ack).toBeDefined();
    const ackText = `${ack?.subject}\n${ack?.html}\n${ack?.text ?? ""}`;
    expect(ackText).toContain("Acme");
    expect(ackText).not.toContain("evil.example");
    expect(ackText).not.toContain("prize");
    expect(ackText).not.toContain("Click");
  });
});

describe("helpdesk email limit counts only genuine submits", () => {
  test("dropped submits with a victim's address do not lock the address out", async () => {
    const victim = "victim@example.com";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const dropped = await postSubmit(
        ctx.stack,
        await submitBody(ctx.stack, { email: victim, website: "http://bot.example" }),
      );
      expect(dropped.status).toBe(200);
    }
    const stale = await fetchChallenge(ctx.stack);
    const unsolved = await postSubmit(ctx.stack, {
      ...(await submitBody(ctx.stack, { email: victim })),
      challenge: stale.challenge,
      nonce: `${Number(solve(stale)) + 1}x`,
    });
    expect(unsolved.status).toBe(200);
    expect(await loadRequests(ctx.stack)).toHaveLength(0);

    const genuine = await postSubmit(ctx.stack, await submitBody(ctx.stack, { email: victim }));
    expect(genuine.status).toBe(200);
    expect(await loadRequests(ctx.stack)).toHaveLength(1);
  });

  test("the fourth genuine submit for one address in a day is limited", async () => {
    const email = "chatty@example.com";
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await postSubmit(ctx.stack, await submitBody(ctx.stack, { email }))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(await loadRequests(ctx.stack)).toHaveLength(3);
    expect(emailTransport.sent.length).toBeGreaterThan(0);
  });
});

describe("helpdesk report limit, subject and page", () => {
  test("a user may file ten reports an hour", async () => {
    const reporter = await seedReporter(ctx.stack, "rita@example.com");
    const report = { kind: "bug", subject: "Crash", message: "It crashes." };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await ctx.stack.http.writeOk(HelpdeskHandlers.report, report, reporter);
    }
    const eleventh = await ctx.stack.http.writeErr(HelpdeskHandlers.report, report, reporter);
    expect(eleventh.httpStatus).toBe(429);
  });

  test("a lone carriage return ends the derived subject", async () => {
    await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, { message: "First line\rSecond line", email: "cr@example.com" }),
    );
    const [request] = await loadRequests(ctx.stack);
    expect(request?.["subject"]).toBe("First line");
  });

  test("the stored page loses its query string and fragment", async () => {
    await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, {
        page: "/pricing?token=secret123&utm=x#section",
        email: "page@example.com",
      }),
    );
    const [request] = await loadRequests(ctx.stack);
    expect(request?.["page"]).toBe("/pricing");
  });
});
