// GDPR Art. 17 end to end on the full bundled composition: a user leaves data through the
// real HTTP surface (session, upload, notes, note history, form draft, export request),
// asks for deletion, the operator forget run executes, and afterwards every table of the
// database and the file storage are scanned for the user's email and name.
// The search index is not scanned: this sample configures no search index (the dev stack's
// adapter is never configured for any tenant), so nothing would be indexed to find.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type KumikoServerHandle, runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { seedTenant } from "@cosmicdrift/kumiko-dev-server/testing";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { InProcessSeededTenant } from "@cosmicdrift/kumiko-testing";
import { PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e/constants";
import { devAppOptions } from "../app/dev-app-options";

const ENV_KEYS = [
  "JWT_SECRET",
  "KUMIKO_SECRETS_MASTER_KEY_V1",
  "KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION",
] as const;
const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

let handle: KumikoServerHandle;
let tenant: InProcessSeededTenant;

beforeAll(async () => {
  process.env["JWT_SECRET"] = PLAYWRIGHT_DEMO_ENV.JWT_SECRET;
  process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = PLAYWRIGHT_DEMO_ENV.KUMIKO_SECRETS_MASTER_KEY_V1;
  process.env["KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION"] = "1";
  const {
    clientEntry: _client,
    htmlPath: _html,
    watchDirs: _watch,
    seeds: _seeds,
    ...options
  } = devAppOptions;
  handle = await runDevApp({
    ...options,
    port: 0,
    installSignalHandlers: false,
    stylesheet: false,
  });
  tenant = await seedTenant(handle.stack, { persist: true });
  await handle.stack.http.writeOk(
    "config:write:set",
    { key: "file-foundation:config:provider", value: "inmemory" },
    tenant.admin.session,
  );
});

afterAll(async () => {
  await handle?.stop();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

type TableHit = { table: string; rows: number };

async function scanTables(marker: string): Promise<TableHit[]> {
  const raw = asRawClient(handle.stack.db);
  const tables = (await raw.unsafe(
    `SELECT table_schema, table_name FROM information_schema.tables
      WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')`,
  )) as ReadonlyArray<{ table_schema: string; table_name: string }>;
  const hits: TableHit[] = [];
  for (const { table_schema, table_name } of tables) {
    const counted = (await raw.unsafe(
      `SELECT count(*)::int AS n FROM "${table_schema}"."${table_name}" t WHERE t::text ILIKE $1`,
      [`%${marker}%`],
    )) as ReadonlyArray<{ n: number }>;
    const rows = counted[0]?.n ?? 0;
    if (rows > 0) hits.push({ table: `${table_schema}.${table_name}`, rows });
  }
  return hits;
}

// Names the events and payload fields that still carry the marker, so a finding points at
// the writer instead of just at the table.
async function describeEventHits(marker: string): Promise<string[]> {
  const rows = (await asRawClient(handle.stack.db).unsafe(
    `SELECT "type", "version", "payload"::text AS payload FROM "kumiko_events" e
      WHERE e::text ILIKE $1 ORDER BY "id"`,
    [`%${marker}%`],
  )) as ReadonlyArray<{ type: string; version: number; payload: string }>;
  return rows.map((row) => {
    const parsed: unknown = JSON.parse(row.payload);
    const fields =
      parsed !== null && typeof parsed === "object"
        ? Object.entries(parsed)
            .filter(([, value]) => JSON.stringify(value).toLowerCase().includes(marker))
            .map(([key]) => key)
        : [];
    return `${row.type}@${row.version} fields=${fields.join(",") || "(outside payload)"}`;
  });
}

async function scanStorage(marker: string): Promise<string[]> {
  const resolve = handle.stack.context._fileProviderResolver;
  if (!resolve) throw new Error("no file provider resolver on the dev stack");
  const provider = await resolve(tenant.id);
  if (!provider.list) throw new Error("file provider cannot list keys");
  const decoder = new TextDecoder();
  const hits: string[] = [];
  for (const key of await provider.list("")) {
    const content = decoder.decode(await provider.read(key)).toLowerCase();
    if (key.toLowerCase().includes(marker) || content.includes(marker)) hits.push(key);
  }
  return hits;
}

describe("GDPR forget leaves no trace", () => {
  test("after the forget run no table or stored file carries the user's email or name", async () => {
    const marker = `quaxford${crypto.randomUUID().slice(0, 8)}`;
    const email = `zebulon.${marker}@example.test`;
    const displayName = `Zebulon ${marker}`;
    const victim = await tenant.addUser([ROLES.TenantAdmin], { email, displayName });
    const http = handle.stack.http;

    const login = await handle.stack.app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: victim.password }),
    });
    expect(login.status).toBe(200);
    const authCookie = (login.headers.getSetCookie?.() ?? [])
      .map((cookie) => cookie.split(";")[0] ?? "")
      .filter((cookie) => cookie.startsWith("kumiko_auth=") || cookie.startsWith("kumiko_csrf="));
    const csrfToken = authCookie
      .find((cookie) => cookie.startsWith("kumiko_csrf="))
      ?.slice("kumiko_csrf=".length);

    const form = new FormData();
    form.append(
      "file",
      new File([`Lebenslauf ${displayName} <${email}>`], `cv-${marker}.txt`, {
        type: "text/plain",
      }),
    );
    const upload = await handle.stack.app.request("/api/files", {
      method: "POST",
      body: form,
      headers: { Cookie: authCookie.join("; "), "X-CSRF-Token": csrfToken ?? "" },
    });
    expect({ status: upload.status, body: await upload.clone().text() }).toMatchObject({
      status: 201,
    });

    const note = await http.writeOk<{ id: string }>(
      "notes-demo:write:note:create",
      { title: "Rückruf-Notiz" },
      victim.session,
    );
    await http.writeOk(
      "notes-history:write:add-note",
      { entityType: "note", entityId: note.id, body: `Rückruf an ${displayName}, ${email}` },
      victim.session,
    );
    await http.writeOk(
      "form-draft:write:save",
      { draftKey: "profile-step", values: { name: displayName, email }, stepIndex: 0 },
      victim.session,
    );
    await http.writeOk("user-data-rights:write:request-export", {}, victim.session);

    const before = {
      tables: await scanTables(marker),
      storage: await scanStorage(marker),
    };
    // Positive control: the draft row exists and its blob is stored as ciphertext, so the
    // marker cannot show up in any table unless something writes it in plaintext.
    const draftRows = (await asRawClient(handle.stack.db).unsafe(
      `SELECT "draft"::text AS draft FROM "read_form_drafts" WHERE "draft_key" = 'profile-step'`,
    )) as ReadonlyArray<{ draft: string }>;
    expect(draftRows.map((row) => row.draft.startsWith('"kumiko-pii:'))).toEqual([true]);
    expect(before.storage.length).toBeGreaterThan(0);

    // Scanner control: a plaintext value in a non-personal field must be found by the table scanner,
    // otherwise "no findings" after the forget run would prove nothing.
    const controlMarker = `ctrlquax${crypto.randomUUID().slice(0, 8)}`;
    await http.writeOk(
      "notes-demo:write:note:create",
      { title: `Kontrolle ${controlMarker}` },
      tenant.admin.session,
    );
    const controlTables = (await scanTables(controlMarker)).map((hit) => hit.table);
    expect(controlTables).toContain("public.read_demo_notes");
    expect(controlTables).toContain("public.kumiko_events");

    // Tenant admin shortens the grace period through the regular compliance override so the
    // operator run executes now instead of in 30 days.
    await http.writeOk(
      "compliance-profiles:write:set-profile",
      {
        profileKey: "eu-dsgvo",
        override: JSON.stringify({ userRights: { gracePeriod: { days: 0 } } }),
      },
      tenant.admin.session,
    );
    await http.writeOk("user-data-rights:write:request-deletion", {}, victim.session);

    const forget = await handle.stack.dispatcher.write(
      "user-data-rights:write:run-forget-cleanup",
      {},
      createSystemUser(SYSTEM_TENANT_ID),
    );
    expect(forget.isSuccess).toBe(true);

    const after = {
      tables: await scanTables(marker),
      storage: await scanStorage(marker),
    };
    const eventHits = await describeEventHits(marker);
    console.log(`GDPR-SCAN ${JSON.stringify({ forget, before, after, eventHits }, null, 1)}`);
    expect(after).toEqual({ tables: [], storage: [] });
  });
});
