import {
  access,
  createSystemUser,
  defineQueryHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { unprocessable } from "../../shared/index.ts";
import { ConnectorErrors, ConnectorQueries, PENDING_REQUEST_RATE_LIMIT } from "../constants.ts";
import { hashUserCode, normalizeUserCode } from "../hash.ts";

const pendingRequestSchema = z
  .object({ requestedAt: z.string(), requestIp: z.string(), expiresAt: z.string() })
  .nullable();

const PENDING_REQUEST_REASON =
  "pairing requests live in the system tenant (the device has no tenant before an admin confirms its code); the query returns time and IP of exactly the one request whose code the admin typed, and nothing for an unknown, expired or confirmed code";

export const pendingRequestQuery = defineQueryHandler({
  name: "pending-request",
  schema: z.object({ userCode: z.string().min(1).max(32) }),
  access: { roles: access.admin },
  rateLimit: PENDING_REQUEST_RATE_LIMIT,
  escapeHatch: { grants: ["systemIdentity"], reason: PENDING_REQUEST_REASON },
  agent: { expose: false },
  description:
    "Shows when and from which IP address a satellite requested the pairing code an admin is about to confirm. Use it to check that the request is yours before you confirm the code.",
  handler: async (query, ctx) => {
    const normalized = normalizeUserCode(query.payload.userCode);
    if (normalized === null) {
      return unprocessable(ConnectorErrors.invalidUserCode, "errors.connectors.invalidUserCode");
    }
    const pending = pendingRequestSchema.parse(
      await ctx.dispatch.queryAs(
        createSystemUser(SYSTEM_TENANT_ID),
        ConnectorQueries.resolvePendingAuthorization,
        { userCodeHash: hashUserCode(normalized) },
      ),
    );
    if (pending === null) {
      return unprocessable(ConnectorErrors.invalidUserCode, "errors.connectors.invalidUserCode");
    }
    return pending;
  },
});
