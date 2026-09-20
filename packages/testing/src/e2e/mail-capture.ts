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
  tenantId: string,
  to: string,
): Promise<readonly CapturedMail[]> {
  const response = await request.get(SEED_ROUTES.inbox, {
    headers: seedRouteHeaders(),
    params: { tenantId, to },
  });
  if (!response.ok()) {
    throw new Error(
      `mailCapture: GET ${SEED_ROUTES.inbox} -> ${response.status()} ${await response.text()}`,
    );
  }
  return inboxResponseSchema.parse(await response.json()).messages;
}

export function mailCapture(
  request: APIRequestContext,
  tenantId: string,
  to: string,
): Promise<readonly CapturedMail[]> {
  return waitForProjection(
    () => readInbox(request, tenantId, to),
    (messages) => messages.length > 0,
    `mailCapture: no mail arrived for ${to} in tenant ${tenantId}`,
  );
}
