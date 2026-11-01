import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { ContactHandlers, ContactQueries } from "../web/constants.ts";
import {
  fetchChallenge,
  loadRequests,
  mailsTo,
  postSubmit,
  seedAdmin,
  seedReporter,
  solve,
  submitBody,
} from "./contact-helpers.ts";
import {
  type ContactTestStack,
  createContactTestStack,
  emailTransport,
  resetContactTestState,
} from "./contact-test-stack.ts";

let ctx: ContactTestStack;
let admin: SessionUser;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createContactTestStack();
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetContactTestState(ctx);
  admin = await seedAdmin(ctx.stack, "admin1@example.com");
  await seedAdmin(ctx.stack, "admin2@example.com");
});

describe("contact submit", () => {
  test("stores the request, mails every SystemAdmin and confirms to the sender", async () => {
    const res = await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, { email: "ada@example.com" }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { kind: string } }).data.kind).toBe("submitted");

    const rows = await loadRequests(ctx.stack);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["status"]).toBe("open");
    expect(rows[0]?.["source"]).toBe("website");
    expect(rows[0]?.["subject"]).toBe("How do I export my data?");

    expect(mailsTo("admin1@example.com")).toHaveLength(1);
    expect(mailsTo("admin2@example.com")).toHaveLength(1);
    const confirmation = mailsTo("ada@example.com");
    expect(confirmation).toHaveLength(1);
    expect(confirmation[0]?.html).toContain("Acme");
    expect(confirmation[0]?.html).not.toContain("How do I export my data?");
  });

  test("honeypot, unknown challenge, reused challenge and wrong proof of work answer 200 and store nothing", async () => {
    const honeypot = await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, { website: "http://spam.example" }),
    );
    expect(honeypot.status).toBe(200);

    const unknown = await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, { challenge: "does-not-exist", nonce: "1" }),
    );
    expect(unknown.status).toBe(200);

    const reusable = await submitBody(ctx.stack);
    expect((await postSubmit(ctx.stack, reusable)).status).toBe(200);
    expect(await loadRequests(ctx.stack)).toHaveLength(1);
    const replay = await postSubmit(ctx.stack, { ...reusable, email: "replay@example.com" });
    expect(replay.status).toBe(200);

    const challenge = await fetchChallenge(ctx.stack);
    let nonce = 0;
    while (Number(solve(challenge)) === nonce) nonce += 1;
    const wrong = await postSubmit(ctx.stack, {
      ...(await submitBody(ctx.stack)),
      challenge: challenge.challenge,
      nonce: String(nonce + 1_000_000),
    });
    expect(wrong.status).toBe(200);

    expect(await loadRequests(ctx.stack)).toHaveLength(1);
    expect(mailsTo("replay@example.com")).toHaveLength(0);
  });

  test("the sixth submit from one IP is rate limited", async () => {
    const ip = { "x-forwarded-for": "203.0.113.77" };
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push(
        (
          await postSubmit(
            ctx.stack,
            await submitBody(ctx.stack, { email: `rl${attempt}@example.com` }),
            ip,
          )
        ).status,
      );
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });

  test("a phone number is refused while the phone field is off", async () => {
    const res = await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, { phone: "+49 30 1234567" }),
    );
    expect(res.status).toBe(422);
    expect(await loadRequests(ctx.stack)).toHaveLength(0);
  });
});

describe("contact submit with a session", () => {
  test("a signed-in caller with an app-specific role gets a challenge and submits", async () => {
    const reporter = await seedReporter(ctx.stack, "jonas.becker@hausverwaltung-nord.example");
    const hausmeister: SessionUser = { ...reporter, roles: ["Hausmeister"] };
    const challenge = await ctx.stack.http.queryOk<{ challenge: string; bits: number }>(
      ContactQueries.challenge,
      {},
      hausmeister,
    );
    const data = await ctx.stack.http.writeOk<{ kind: string }>(
      ContactHandlers.submit,
      {
        kind: "question",
        name: "Jonas Becker",
        email: "jonas.becker@hausverwaltung-nord.example",
        message: "Lässt sich die Heizkostenabrechnung als PDF exportieren?",
        locale: "de",
        challenge: challenge.challenge,
        nonce: solve(challenge),
      },
      hausmeister,
    );
    expect(data.kind).toBe("submitted");
    expect(await loadRequests(ctx.stack)).toHaveLength(1);
  });
});

describe("contact report access", () => {
  test("a signed-in user without an admin role files a report", async () => {
    const plain = await seedReporter(ctx.stack, "plain@example.com");
    const asPlainUser: SessionUser = { ...plain, roles: ["Viewer"] };
    const data = await ctx.stack.http.writeOk<{ kind: string; id: string }>(
      ContactHandlers.report,
      { kind: "bug", subject: "Button does nothing", message: "Clicking save has no effect." },
      asPlainUser,
    );
    expect(data.kind).toBe("reported");
    const [stored] = await loadRequests(ctx.stack);
    expect(stored?.["source"]).toBe("admin");
    expect(stored?.["reporterUserId"]).toBe(plain.id);
  });
});

describe("contact admin queries and access", () => {
  test("only a SystemAdmin reaches reply, mark-done, open-count, replies and delivery", async () => {
    const reporter = await seedReporter(ctx.stack, "member@example.com");
    for (const [type, payload] of [
      [ContactHandlers.reply, { requestId: crypto.randomUUID(), message: "hi" }],
      [ContactHandlers.markDone, { id: crypto.randomUUID() }],
      [ContactHandlers.sendTest, {}],
    ] as const) {
      const res = await ctx.stack.http.write(type, payload, reporter);
      expect(res.status).toBe(403);
    }
    for (const type of [
      ContactQueries.openCount,
      ContactQueries.replies,
      ContactQueries.requestDelivery,
      ContactQueries.requestDetail,
    ]) {
      const res = await ctx.stack.http.query(type, { id: crypto.randomUUID() }, reporter);
      expect([400, 403]).toContain(res.status);
    }
    const internal = await ctx.stack.http.write(
      ContactHandlers.forwardRequest,
      { requestId: crypto.randomUUID() },
      admin,
    );
    expect(internal.status).toBe(403);
  });

  test("open count counts only requests that wait for a first answer", async () => {
    await postSubmit(ctx.stack, await submitBody(ctx.stack));
    await postSubmit(ctx.stack, await submitBody(ctx.stack));
    const [first] = await loadRequests(ctx.stack);
    const before = await ctx.stack.http.queryOk<{ count: number }>(
      ContactQueries.openCount,
      {},
      admin,
    );
    expect(before.count).toBe(2);

    await ctx.stack.http.writeOk(
      ContactHandlers.reply,
      { requestId: String(first?.["id"]), message: "On it." },
      admin,
    );
    const after = await ctx.stack.http.queryOk<{ count: number }>(
      ContactQueries.openCount,
      {},
      admin,
    );
    expect(after.count).toBe(1);
    expect(emailTransport.sent.length).toBeGreaterThan(0);
  });
});
