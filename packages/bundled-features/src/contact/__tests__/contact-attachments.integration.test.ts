import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import { ContactHandlers, ContactQueries, ContactScreens } from "../web/constants.ts";
import {
  downloadFile,
  loadReplies,
  loadRequests,
  mailsTo,
  postSubmit,
  seedAdmin,
  seedReporter,
  seedRoamingAdmin,
  submitBody,
  uploadFormFile,
} from "./contact-helpers.ts";
import {
  type ContactTestStack,
  createContactTestStack,
  emailTransport,
  resetContactTestState,
} from "./contact-test-stack.ts";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 contact attachment");

let ctx: ContactTestStack;
let admin: SessionUser;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
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
  await ctx.stack.http.writeOk(
    "config:write:set",
    { key: "file-foundation:config:provider", value: "inmemory", scope: "system" },
    admin,
  );
});

function pdf(name: string) {
  return { name, type: "application/pdf", bytes: PDF_BYTES };
}

describe("contact report attachments", () => {
  test("a report carries the uploaded file into the system tenant where a SystemAdmin downloads it", async () => {
    const reporter = await seedReporter(ctx.stack, "rita@example.com");
    const uploadId = await uploadFormFile(
      ctx.stack,
      reporter,
      ContactScreens.report,
      pdf("log.pdf"),
    );

    await ctx.stack.http.writeOk(
      ContactHandlers.report,
      { kind: "bug", subject: "Crash", message: "See the log.", fileIds: [uploadId] },
      reporter,
    );

    const [row] = await loadRequests(ctx.stack);
    expect(row?.["fileCount"]).toBe(1);
    const detail = await ctx.stack.http.queryOk<{ fileIds: string[]; fileCount: number }>(
      ContactQueries.requestDetail,
      { id: String(row?.["id"]) },
      admin,
    );
    expect(detail.fileCount).toBe(1);
    const [storedId] = detail.fileIds;
    if (storedId === undefined) throw new Error("request holds no file");
    expect(storedId).not.toBe(uploadId);

    const download = await downloadFile(ctx.stack, admin, storedId);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PDF_BYTES);
    expect(download.headers.get("content-disposition")).toContain("log.pdf");
    expect((await downloadFile(ctx.stack, reporter, uploadId)).status).toBe(404);
  });

  test("a file uploaded by someone else is refused and nothing is stored", async () => {
    const reporter = await seedReporter(ctx.stack, "rita@example.com");
    const other = await seedReporter(ctx.stack, "otto@example.com", "Other GmbH");
    const foreignId = await uploadFormFile(
      ctx.stack,
      other,
      ContactScreens.report,
      pdf("foreign.pdf"),
    );

    const failure = await ctx.stack.http.writeErr(
      ContactHandlers.report,
      { kind: "bug", subject: "Crash", message: "Mine?", fileIds: [foreignId] },
      reporter,
    );

    expect(failure.httpStatus).toBe(422);
    expect(await loadRequests(ctx.stack)).toHaveLength(0);
    expect(emailTransport.sent).toHaveLength(0);
    expect((await downloadFile(ctx.stack, other, foreignId)).status).toBe(200);
  });
});

describe("contact reply attachments", () => {
  async function anonymousRequestId(): Promise<string> {
    const res = await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, { email: "ada@example.com" }),
    );
    expect(res.status).toBe(200);
    const [row] = await loadRequests(ctx.stack);
    return String(row?.["id"]);
  }

  async function expectReplyMailCarries(name: string): Promise<void> {
    const [mail] = mailsTo("ada@example.com").filter((m) => m.attachments?.length);
    const [attachment] = mail?.attachments ?? [];
    expect(attachment?.fileName).toBe(name);
    expect(attachment?.content).toEqual(PDF_BYTES);
    const [reply] = await loadReplies(ctx.stack);
    expect(reply?.["fileIds"]).toHaveLength(1);
  }

  test("an admin in the system tenant attaches an uploaded file to the reply mail", async () => {
    const requestId = await anonymousRequestId();
    emailTransport.sent.length = 0;
    const uploadId = await uploadFormFile(
      ctx.stack,
      admin,
      ContactScreens.replyMail,
      pdf("answer.pdf"),
    );

    await ctx.stack.http.writeOk(
      ContactHandlers.reply,
      { requestId, message: "See attached.", fileIds: [uploadId] },
      admin,
    );

    await expectReplyMailCarries("answer.pdf");
  });

  test("an admin signed in to another tenant attaches a file too", async () => {
    const requestId = await anonymousRequestId();
    emailTransport.sent.length = 0;
    const roaming = await seedRoamingAdmin(ctx.stack, "roaming@example.com");
    const uploadId = await uploadFormFile(
      ctx.stack,
      roaming,
      ContactScreens.replyMail,
      pdf("from-elsewhere.pdf"),
    );

    await ctx.stack.http.writeOk(
      ContactHandlers.reply,
      { requestId, message: "See attached.", fileIds: [uploadId] },
      roaming,
    );

    await expectReplyMailCarries("from-elsewhere.pdf");
    expect((await downloadFile(ctx.stack, roaming, uploadId)).status).toBe(404);
  });

  test("a signed-in reporter is answered through the in-app variant of the reply form", async () => {
    const reporter = await seedReporter(ctx.stack, "rita@example.com");
    await ctx.stack.http.writeOk(
      ContactHandlers.report,
      { kind: "bug", subject: "Crash", message: "Please look." },
      reporter,
    );
    const [row] = await loadRequests(ctx.stack);
    const requestId = String(row?.["id"]);
    emailTransport.sent.length = 0;
    const uploadId = await uploadFormFile(
      ctx.stack,
      admin,
      ContactScreens.reply,
      pdf("in-app.pdf"),
    );

    await ctx.stack.http.writeOk(
      ContactHandlers.reply,
      { requestId, message: "See attached.", fileIds: [uploadId] },
      admin,
    );

    const [reply] = await loadReplies(ctx.stack);
    expect(reply?.["channels"]).toBe("email+inApp");
    expect(reply?.["fileIds"]).toHaveLength(1);
  });

  test("an upload from the other variant of the reply form is refused", async () => {
    const requestId = await anonymousRequestId();
    const uploadId = await uploadFormFile(
      ctx.stack,
      admin,
      ContactScreens.reply,
      pdf("wrong-form.pdf"),
    );

    const failure = await ctx.stack.http.writeErr(
      ContactHandlers.reply,
      { requestId, message: "See attached.", fileIds: [uploadId] },
      admin,
    );

    expect(failure.httpStatus).toBe(422);
    expect(await loadReplies(ctx.stack)).toHaveLength(0);
  });
});
