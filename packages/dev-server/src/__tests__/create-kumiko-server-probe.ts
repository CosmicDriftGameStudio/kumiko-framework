import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";

const probeEntity = createEntity({
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    done: createBooleanField(),
  },
  table: "kumiko_server_probe",
});

export const probeFeature = defineFeature("dev-server-probe", (r) => {
  r.entity({ name: "probe", ...probeEntity });
  // Anonymous query for hostDispatch's deps.systemQuery — proves the
  // dev path gets the same anonymous-role dispatch-deps shape as prod.
  r.queryHandler({
    name: "ping",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    handler: async () => ({ pong: true }),
  });
  // Echoes the resolved client IP — proves a real Bun.serve socket address
  // reaches requestContext.ip through handleFetch (every other test drives
  // h.fetch()/handle.fetch() directly, never Bun.serve's real socket).
  r.queryHandler({
    name: "whoami",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    handler: async () => ({ ip: requestContext.get()?.ip }),
  });
  // SystemAdmin-gated write — the `entry:"signature"` / `wire` tests verify
  // that echoing user.tenantId and roles passes through the real dispatcher
  // (Zod and access checks) with the target tenant's system user.
  r.writeHandler({
    name: "probe-write",
    schema: z.object({ note: z.string() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event) => ({
      isSuccess: true as const,
      data: { tenantSeen: event.user.tenantId, roles: event.user.roles },
    }),
  });
});
