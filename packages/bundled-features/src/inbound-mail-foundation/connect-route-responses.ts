import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { Context } from "hono";
import { InboundMailConnectErrors } from "./constants.ts";

const CONNECT_CONFLICT_MESSAGES: Readonly<Record<string, string>> = {
  [InboundMailConnectErrors.addressAlreadyConnected.reason]:
    "this mailbox address is already connected",
  [InboundMailConnectErrors.addressDisconnected.reason]:
    "this mailbox was disconnected before; reconnect it from the mailbox list instead",
};

export function connectFailureResponse(c: Context, error: unknown) {
  const reason = propertyOf(propertyOf(error, "details"), "reason");
  const conflict = typeof reason === "string" ? CONNECT_CONFLICT_MESSAGES[reason] : undefined;
  if (typeof reason === "string" && conflict) return errorJson(c, 409, reason, conflict);
  return errorJson(c, 502, "account_create_failed", JSON.stringify(error ?? {}));
}

export function errorJson(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 502,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}
