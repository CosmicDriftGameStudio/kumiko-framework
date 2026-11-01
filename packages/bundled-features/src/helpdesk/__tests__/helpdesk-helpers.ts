import { expect } from "bun:test";
import { createTenantDb, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { buildMultipartBody } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { seedTenant, seedTenantMembership } from "../../tenant/seeding.ts";
import { seedUser } from "../../user/seeding.ts";
import { helpdeskReplyTable, helpdeskRequestTable } from "../entity.ts";
import { verifyProofOfWork } from "../pow.ts";
import { HELPDESK_UPLOAD_FIELD, HelpdeskHandlers, HelpdeskQueries } from "../web/constants.ts";
import { emailTransport } from "./helpdesk-test-stack.ts";

export type Challenge = { challenge: string; bits: number };

let ipCounter = 0;
export function freshIp(): Record<string, string> {
  ipCounter += 1;
  return { "x-forwarded-for": `198.51.100.${ipCounter % 250}` };
}

let senderCounter = 0;
export function nextSenderEmail(): string {
  senderCounter += 1;
  return `sender${senderCounter}@example.com`;
}

export async function fetchChallenge(stack: TestStack): Promise<Challenge> {
  const res = await stack.http.raw(
    "POST",
    "/api/query",
    { type: HelpdeskQueries.challenge, payload: {} },
    freshIp(),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { isSuccess: boolean; data: Challenge };
  return body.data;
}

export function solve(challenge: Challenge): string {
  for (let nonce = 0; ; nonce += 1) {
    if (
      verifyProofOfWork({
        challenge: challenge.challenge,
        nonce: String(nonce),
        bits: challenge.bits,
      })
    ) {
      return String(nonce);
    }
  }
}

export async function submitBody(
  stack: TestStack,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const challenge = await fetchChallenge(stack);
  return {
    kind: "question",
    name: "Ada Lovelace",
    email: nextSenderEmail(),
    message: "How do I export my data?\nSecond line.",
    locale: "en",
    challenge: challenge.challenge,
    nonce: solve(challenge),
    ...extra,
  };
}

export function postSubmit(
  stack: TestStack,
  body: Record<string, unknown>,
  headers: Record<string, string> = freshIp(),
) {
  return stack.http.raw(
    "POST",
    "/api/write",
    { type: HelpdeskHandlers.submit, payload: body },
    headers,
  );
}

export async function loadRequests(stack: TestStack) {
  return selectMany(
    createTenantDb({
      db: stack.db,
      tenantId: SYSTEM_TENANT_ID,
      mode: "system",
      reason: "test reads platform-wide helpdesk rows",
    }),
    helpdeskRequestTable,
    {},
  );
}

export async function loadReplies(stack: TestStack) {
  return selectMany(stack.db, helpdeskReplyTable, {});
}

export function mailsTo(email: string) {
  return emailTransport.sent.filter((mail) => mail.to === email);
}

export async function seedAdmin(stack: TestStack, email: string): Promise<SessionUser> {
  const { id } = await seedUser(stack.db, {
    email,
    displayName: `Admin ${email}`,
    roles: ["SystemAdmin"],
    emailVerified: true,
  });
  return { id, tenantId: SYSTEM_TENANT_ID, roles: ["SystemAdmin"] };
}

export async function seedReporter(
  stack: TestStack,
  email: string,
  tenantName = "Reporter GmbH",
): Promise<SessionUser> {
  const tenantId = crypto.randomUUID() as TenantId;
  await seedTenant(stack.db, { id: tenantId, key: `t-${tenantId.slice(0, 8)}`, name: tenantName });
  const { id } = await seedUser(stack.db, {
    email,
    displayName: "Rita Reporter",
    emailVerified: true,
  });
  await seedTenantMembership(stack.db, { userId: id, tenantId, roles: ["TenantAdmin"] });
  return { id, tenantId, roles: ["TenantAdmin"] };
}

// Uploads one file into the files field of a contact form screen; it stays pending until the
// report or reply handler takes it over.
export async function uploadFormFile(
  stack: TestStack,
  as: SessionUser,
  screen: string,
  file: { readonly name: string; readonly type: string; readonly bytes: Uint8Array },
): Promise<string> {
  const token = await stack.jwt.sign(as);
  const form = new FormData();
  form.append("actionForm", screen);
  form.append("fieldName", HELPDESK_UPLOAD_FIELD);
  form.append("file", new File([Buffer.from(file.bytes)], file.name, { type: file.type }));
  const { body, contentType } = await buildMultipartBody(form);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

export async function downloadFile(
  stack: TestStack,
  as: SessionUser,
  fileRefId: string,
): Promise<Response> {
  const token = await stack.jwt.sign(as);
  return stack.app.request(`/api/files/${fileRefId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// A SystemAdmin whose session is in a customer tenant instead of the system tenant.
export async function seedRoamingAdmin(stack: TestStack, email: string): Promise<SessionUser> {
  const tenantId = crypto.randomUUID() as TenantId;
  await seedTenant(stack.db, {
    id: tenantId,
    key: `t-${tenantId.slice(0, 8)}`,
    name: "Roaming GmbH",
  });
  const { id } = await seedUser(stack.db, {
    email,
    displayName: `Admin ${email}`,
    roles: ["SystemAdmin"],
    emailVerified: true,
  });
  await seedTenantMembership(stack.db, { userId: id, tenantId, roles: ["TenantAdmin"] });
  return { id, tenantId, roles: ["SystemAdmin"] };
}
