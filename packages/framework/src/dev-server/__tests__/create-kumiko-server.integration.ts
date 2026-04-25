import { sql } from "drizzle-orm";
import { afterEach, describe, expect, test } from "vitest";
import { defineFeature } from "../../engine";
import { createBooleanField, createEntity, createTextField } from "../../engine/factories";
import { createKumikoServer, type KumikoServerHandle } from "../create-kumiko-server";

// Integration-Test: bootet createKumikoServer mit echtem Postgres,
// echtem Redis, echter Kumiko-Pipeline. Treibt den fetch-Handler
// direkt an (nicht über Bun.serve + Socket), weil vitest unter Node
// läuft. Unter Bun würde derselbe Handler identisch antworten —
// das Routing ist runtime-neutral.

const probeEntity = createEntity({
  fields: {
    title: createTextField({ required: true }),
    done: createBooleanField(),
  },
  table: "kumiko_server_probe",
});

const probeFeature = defineFeature("dev-server-probe", (r) => {
  r.entity("probe", probeEntity);
});

let handle: KumikoServerHandle | undefined;

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = undefined;
  }
});

async function boot(): Promise<KumikoServerHandle> {
  handle = await createKumikoServer({
    features: [probeFeature],
    port: 0,
    installSignalHandlers: false,
  });
  return handle;
}

describe("createKumikoServer", () => {
  test("bootet den Kumiko-Stack + legt die Feature-Tables an", async () => {
    const h = await boot();
    const rows = await h.stack.db.execute<{ exists: boolean }>(
      sql`SELECT to_regclass('public.kumiko_server_probe') IS NOT NULL AS exists`,
    );
    expect(rows[0]?.exists).toBe(true);
  });

  test("GET / → HTML + kumiko_auth/kumiko_csrf Set-Cookie", async () => {
    const h = await boot();
    const res = await h.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/kumiko_auth=/);
    expect(setCookie).toMatch(/kumiko_csrf=/);
    const body = await res.text();
    expect(body).toMatch(/<div id="root">/);
    // Reload-Snippet wurde in </body> injiziert.
    expect(body).toMatch(/EventSource\("\/_reload"\)/);
  });

  test("GET /client.js → 200 mit leerem Body wenn clientEntry fehlt", async () => {
    const h = await boot();
    const res = await h.fetch(new Request("http://localhost/client.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/javascript/);
    expect(await res.text()).toBe("");
  });

  test("GET /client.js.map → 404 wenn kein Sourcemap vorhanden", async () => {
    const h = await boot();
    const res = await h.fetch(new Request("http://localhost/client.js.map"));
    expect(res.status).toBe(404);
  });

  test("GET /_reload → text/event-stream mit connected-Komment", async () => {
    const h = await boot();
    const res = await h.fetch(new Request("http://localhost/_reload"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toMatch(/connected/);
    await reader.cancel();
  });

  test("unbekannter Pfad → forwarded an den Hono-Stack", async () => {
    const h = await boot();
    // /api/ghost existiert nicht → Hono liefert 404. Der entscheidende
    // Punkt: die Response kommt VOM Stack, nicht vom Dev-Server-Layer.
    // Wir unterscheiden, indem wir prüfen, dass es KEINE HTML- oder
    // event-stream-Response ist — die gehören zum Dev-Server-Layer.
    const res = await h.fetch(new Request("http://localhost/api/ghost"));
    expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/html/);
    expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/event-stream/);
  });

  test("Server-Instanz ist undefined unter Node (vitest)", async () => {
    // Sanity check: unter Bun wäre .server gesetzt, unter Node
    // (wo dieser Test läuft) muss er undefined sein, sonst hätten
    // wir eine falsche Bun-Detection.
    const h = await boot();
    expect(h.server).toBeUndefined();
  });
});
