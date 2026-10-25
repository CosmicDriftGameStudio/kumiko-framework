// DB runtime gate for use-all-bundled (223/1): after the postgres-smoke
// job was dropped, the real boot of all bundled features against
// Postgres+Redis was no longer gated by anything — boot.test.ts stops before
// the DB. This test boots the full stack (schema apply included)
// and drives a real HTTP round trip through the dispatcher.

import { afterAll, describe, expect, test } from "bun:test";
import { createTemplateResolverApi } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createKumikoServer, type KumikoServerHandle } from "@cosmicdrift/kumiko-dev-server";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { APP_FEATURES, AUTH_COMPOSE_OPTIONS } from "../run-config";

let handle: KumikoServerHandle | undefined;

afterAll(async () => {
  await handle?.stop();
});

describe("use-all-bundled full-stack boot", () => {
  test("every bundled feature boots against real Postgres + Redis, tables applied", async () => {
    handle = await createKumikoServer({
      features: [
        ...composeFeatures([...APP_FEATURES], {
          includeBundled: true,
          authOptions: AUTH_COMPOSE_OPTIONS,
        }),
      ],
      // legal-pages' boot gate resolves text blocks through ctx.templateResolver;
      // the app wires it in app/server.ts and this test boots without that file.
      extraContext: ({ db, registry }) => ({
        templateResolver: createTemplateResolverApi(db, registry),
      }),
      port: 0,
      installSignalHandlers: false,
    });

    const res = await handle.fetch(new Request("http://test/"));
    expect(res.status).toBe(200);

    // Schema wirklich applied — Probe-Tabellen quer durch die Feature-Welt
    // (jobs, delivery, tenant), nicht nur "Server antwortet". audit hat
    // bewusst keine eigene Tabelle (event store IS the trail).
    const rows = await asRawClient(handle.stack.db).unsafe(
      `SELECT
         to_regclass('public.store_job_runs') IS NOT NULL AS "jobs",
         to_regclass('public.store_delivery_attempts') IS NOT NULL AS "delivery",
         to_regclass('public.read_tenants') IS NOT NULL AS "tenant"`,
    );
    const probe = (rows as Array<Record<string, unknown>>)[0];
    expect(probe).toEqual({ jobs: true, delivery: true, tenant: true });
  }, 120_000);
});
