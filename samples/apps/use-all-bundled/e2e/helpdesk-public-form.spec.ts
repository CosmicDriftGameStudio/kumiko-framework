// @runtime test
// The public same-origin contact page (public/helpdesk-contact.html) against the real helpdesk
// feature: the real /helpdesk/client.js loads the challenge, solves the proof of work in the
// browser and submits. Nothing is mocked; the request lands in the SystemAdmin inbox.

import { createHash } from "node:crypto";
import { CLIENT_IP_HEADER, expect, test } from "@cosmicdrift/kumiko-testing/e2e";
import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { Page } from "@playwright/test";
import { requestRowsAsPage } from "./_helpers/helpdesk-flows";
import { loginAsAdmin } from "./_helpers/login";

const CONTACT_PAGE = "/helpdesk-contact.html";
const SUBMIT_TYPE = "helpdesk:write:submit";
const CHALLENGE_TYPE = "helpdesk:query:challenge";

type Challenge = { readonly challenge: string; readonly bits: number };
type SubmitPayload = {
  readonly challenge: unknown;
  readonly nonce: unknown;
  readonly website: unknown;
};

function challengeOf(responseBody: unknown): Challenge {
  const data = propertyOf(responseBody, "data");
  const challenge = propertyOf(data, "challenge");
  const bits = propertyOf(data, "bits");
  if (typeof challenge !== "string" || typeof bits !== "number") {
    throw new Error(`no challenge in ${JSON.stringify(responseBody)}`);
  }
  return { challenge, bits };
}

function submitPayloadOf(requestBody: unknown): SubmitPayload {
  const payload = propertyOf(requestBody, "payload");
  if (!isPlainObject(payload)) throw new Error("submit request carries no payload");
  return { challenge: payload["challenge"], nonce: payload["nonce"], website: payload["website"] };
}

function hasLeadingZeroBits(hash: Buffer, bits: number): boolean {
  for (let bit = 0; bit < bits; bit++) {
    const byte = hash[Math.floor(bit / 8)] ?? 0xff;
    if ((byte >> (7 - (bit % 8))) & 1) return false;
  }
  return true;
}

// Same rule as the server (helpdesk/pow.ts): sha256("<challenge>:<nonce>") starts with `bits` zero bits.
function isValidProofOfWork(challenge: Challenge, nonce: string): boolean {
  const hash = createHash("sha256").update(`${challenge.challenge}:${nonce}`).digest();
  return hasLeadingZeroBits(hash, challenge.bits);
}

function isWriteOf(type: string, postData: string | null): boolean {
  if (postData === null) return false;
  const body: unknown = JSON.parse(postData);
  return typeof body === "object" && body !== null && "type" in body && body.type === type;
}

async function openContactPage(page: Page, clientIp: string): Promise<void> {
  await page.setExtraHTTPHeaders({ [CLIENT_IP_HEADER]: clientIp });
  await page.goto(CONTACT_PAGE);
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
}

async function fillForm(page: Page, name: string, email: string): Promise<void> {
  await page.getByLabel("Topic").selectOption("question");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page
    .getByLabel("Message")
    .fill("Does the status page support a custom domain with our own TLS certificate?");
}

async function requestsFrom(page: Page, name: string) {
  await loginAsAdmin(page);
  const rows = await requestRowsAsPage(page);
  return rows.filter((row) => row.name === name);
}

test("a visitor sends a question: proof of work is solved and the request reaches the inbox", async ({
  page,
}) => {
  const name = `Maya Lindqvist ${crypto.randomUUID().slice(0, 8)}`;
  const challengeResponse = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/query") && isWriteOf(CHALLENGE_TYPE, res.request().postData()),
  );
  await openContactPage(page, "203.0.113.160");
  const challenge = challengeOf(await (await challengeResponse).json());

  await fillForm(page, name, "maya@lindqvist-hosting.example");
  const submitRequest = page.waitForRequest(
    (req) => req.url().endsWith("/api/write") && isWriteOf(SUBMIT_TYPE, req.postData()),
  );
  await page.getByRole("button", { name: "Send message" }).click();
  const sent = submitPayloadOf((await submitRequest).postDataJSON());

  expect(sent.challenge).toBe(challenge.challenge);
  if (typeof sent.nonce !== "string" || sent.nonce === "")
    throw new Error("submit carries no nonce");
  expect(isValidProofOfWork(challenge, sent.nonce)).toBe(true);
  expect(sent.website ?? "").toBe("");
  await expect(page.getByText("Thank you, your message was sent.")).toBeVisible();

  expect(await requestsFrom(page, name)).toHaveLength(1);
});

test("a bot that fills the hidden website field sees success but stores nothing", async ({
  page,
}) => {
  const name = `Bot Visitor ${crypto.randomUUID().slice(0, 8)}`;
  await openContactPage(page, "203.0.113.161");
  await fillForm(page, name, "bot@spam-farm.example");
  await page.locator("#website").fill("https://spam-farm.example", { force: true });

  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Thank you, your message was sent.")).toBeVisible();
  expect(await requestsFrom(page, name)).toHaveLength(0);
});
