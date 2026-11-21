import { createHash } from "node:crypto";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import {
  CONNECTOR_CLIENT_ID,
  CONNECTOR_ROUTE_PATHS,
  ConnectorHandlers,
  DEFAULT_CONNECTORS_BASE_PATH,
  DEVICE_CODE_GRANT_TYPE,
} from "./constants.ts";

// Same as the `basePath` given to createConnectorRoutes().
export type ConnectorTestPathOptions = { readonly basePath?: string };

const routePath = (
  options: ConnectorTestPathOptions,
  route: keyof typeof CONNECTOR_ROUTE_PATHS,
): string => `${options.basePath ?? DEFAULT_CONNECTORS_BASE_PATH}${CONNECTOR_ROUTE_PATHS[route]}`;

const startResponseSchema = z.object({ device_code: z.string(), user_code: z.string() });
const tokenResponseSchema = z.object({ access_token: z.string() });
const approveResultSchema = z.object({ connectorId: z.string() });

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function postForm(stack: TestStack, path: string, fields: Record<string, string>) {
  return stack.app.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function pairConnectorDevice(
  stack: TestStack,
  admin: SessionUser,
  options: ConnectorTestPathOptions & { readonly name?: string } = {},
): Promise<{ token: string; connectorId: string }> {
  const name = options.name ?? "Test device";
  const startPath = routePath(options, "deviceAuthorization");
  const startRes = await postForm(stack, startPath, { client_id: CONNECTOR_CLIENT_ID });
  if (startRes.status !== 200) {
    throw new Error(
      `pairConnectorDevice: ${startPath} answered ${startRes.status}; mount createConnectorRoutes() as extraRoutes of the test stack and pass its basePath here`,
    );
  }
  const started = startResponseSchema.parse(await startRes.json());

  await stack.http.writeOk(ConnectorHandlers.checkDevice, { userCode: started.user_code }, admin);
  const approved = approveResultSchema.parse(
    await stack.http.writeOk(
      ConnectorHandlers.approveDevice,
      { userCode: started.user_code, name },
      admin,
    ),
  );

  const tokenRes = await postForm(stack, routePath(options, "token"), {
    grant_type: DEVICE_CODE_GRANT_TYPE,
    device_code: started.device_code,
    client_id: CONNECTOR_CLIENT_ID,
  });
  const tokenText = await tokenRes.text();
  const token = tokenResponseSchema.safeParse(parseJsonOrUndefined(tokenText));
  if (!token.success) {
    throw new Error(
      `pairConnectorDevice: no access_token (status ${tokenRes.status}): ${tokenText}`,
    );
  }
  return { token: token.data.access_token, connectorId: approved.connectorId };
}

export async function uploadConnectorFile(
  stack: TestStack,
  token: string | null,
  file: { path: string; bytes: Uint8Array<ArrayBuffer>; sha256?: string; mtime?: string },
  options: ConnectorTestPathOptions = {},
): Promise<Response> {
  return stack.app.request(routePath(options, "files"), {
    method: "POST",
    headers: {
      ...(token !== null && { authorization: `Bearer ${token}` }),
      "content-type": "application/octet-stream",
      "x-kumiko-path": encodeURIComponent(file.path),
      "x-kumiko-sha256": file.sha256 ?? sha256Hex(file.bytes),
      "x-kumiko-mtime": file.mtime ?? "2026-11-18T08:30:00Z",
    },
    body: file.bytes,
  });
}

// The job-trigger consumer picks the created event up, then the queue runs the job.
// Without a dispatcher the created event is never picked up and the test would see no rows.
export async function runConnectorJobs(stack: TestStack): Promise<void> {
  if (stack.eventDispatcher === undefined) {
    throw new Error(
      'runConnectorJobs: the test stack runs no jobs; pass jobs: { consumerLane: "worker" } to it',
    );
  }
  await stack.eventDispatcher.runOnce();
  await stack.drainJobs();
}
