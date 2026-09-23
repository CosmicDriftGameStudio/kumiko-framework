import type { APIRequestContext } from "@playwright/test";
import { SEED_ROUTES, SEED_TOKEN_ENV, SEED_TOKEN_HEADER } from "./constants";
import { waitForProjection } from "./poll";
import { type CapturedMail, inboxResponseSchema } from "./seed-contract";

export function seedRouteHeaders(): Record<string, string> {
  const token = process.env[SEED_TOKEN_ENV];
  if (token === undefined || token === "") {
    throw new Error(
      `${SEED_TOKEN_ENV} is not set; build the Playwright config with defineAppE2eConfig`,
    );
  }
  return { [SEED_TOKEN_HEADER]: token };
}

async function readInbox(
  request: APIRequestContext,
  to: string,
  tenantId: string | undefined,
): Promise<readonly CapturedMail[]> {
  const response = await request.get(SEED_ROUTES.inbox, {
    headers: seedRouteHeaders(),
    params: tenantId === undefined ? { to } : { tenantId, to },
  });
  if (!response.ok()) {
    throw new Error(
      `mailCapture: GET ${SEED_ROUTES.inbox} -> ${response.status()} ${await response.text()}`,
    );
  }
  return inboxResponseSchema.parse(await response.json()).messages;
}

export type MailCaptureOptions = {
  readonly tenantId?: string;
  readonly match?: (mail: CapturedMail) => boolean;
};

// The inbox route returns the tenant buffer before the mailOutbox, each
// newest-first; `.find` keeps that order because mails carry no timestamp.
// With both sources mounted, a tenant-buffer match wins over a newer outbox one.
export async function mailCapture(
  request: APIRequestContext,
  to: string,
  opts: MailCaptureOptions = {},
): Promise<CapturedMail> {
  const { tenantId, match } = opts;
  const isCandidate = (mail: CapturedMail) => match === undefined || match(mail);
  const description = tenantId === undefined ? `for ${to}` : `for ${to} in tenant ${tenantId}`;
  const message = `mailCapture: no mail arrived ${description}`;

  const messages = await waitForProjection(
    () => readInbox(request, to, tenantId),
    (candidates) => candidates.some(isCandidate),
    message,
  );
  const mail = messages.find(isCandidate);
  if (mail === undefined) throw new Error(message);
  return mail;
}
