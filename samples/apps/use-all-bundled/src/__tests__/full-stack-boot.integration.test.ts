// DB-Runtime-Gate für use-all-bundled (223/1): nach dem Wegfall des
// postgres-smoke-Jobs war der echte Boot aller Bundled-Features gegen
// Postgres+Redis durch nichts mehr gegated — boot.test.ts stoppt vor
// der DB. Dieser Test bootet den vollen Stack (schema apply inklusive)
// und treibt eine echte HTTP-Round-Trip durch den Dispatcher.

import { afterAll, describe, expect, test } from "bun:test";
import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";
import {
  createKumikoServer,
  type KumikoServerHandle,
} from "@cosmicdrift/kumiko-dev-server";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { APP_FEATURES } from "../run-config";

let handle: KumikoServerHandle | undefined;

afterAll(async () => {
  await handle?.stop();
});

describe("use-all-bundled full-stack boot", () => {
  test("every bundled feature boots against real Postgres + Redis, tables applied", async () => {
    handle = await createKumikoServer({
      features: [...composeFeatures([...APP_FEATURES], { includeBundled: true })],
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
         to_regclass('public.read_job_runs') IS NOT NULL AS "jobs",
         to_regclass('public.read_delivery_attempts') IS NOT NULL AS "delivery",
         to_regclass('public.read_tenants') IS NOT NULL AS "tenant"`,
    );
    const probe = (rows as Array<Record<string, unknown>>)[0];
    expect(probe).toEqual({ jobs: true, delivery: true, tenant: true });
  }, 120_000);
});
