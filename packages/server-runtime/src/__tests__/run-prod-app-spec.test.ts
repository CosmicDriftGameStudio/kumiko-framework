// Spec-Tests für die Bun.serve-Options + Heartbeat-Cadence. Diese
// Konstanten/Defaults haben Live-Bugs verursacht und sind 1-Zeile-
// revertierbar — die Tests pinsen Intent + akzeptablen Range gegen
// "looks like a leak"-Reverts oder "bisschen rauf, sollte reichen"-
// Tweaks.

import { describe, expect, test } from "bun:test";
import { SSE_HEARTBEAT_INTERVAL_MS } from "@cosmicdrift/kumiko-framework/api";
import {
  createEntity,
  createFileField,
  createRegistry,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFilesFeature, resolveMaxUploadBodyBytes } from "@cosmicdrift/kumiko-framework/files";
import {
  DEFAULT_MAX_REQUEST_BODY_SIZE_BYTES,
  resolveDerivedMaxRequestBodySize,
} from "../bun-serve-options";
import { buildBunServeOptions } from "../run-prod-app";

describe("Bun.serve options for production", () => {
  test("idleTimeout is 0 (disabled) — required for SSE long-lived connections", () => {
    // Bun.serve default ist 10s — ohne Override killt das SSE-Streams
    // mit halbem HTTP/2-RST_STREAM. Spec ist "disabled"; jeder andere
    // Wert (auch ein vermeintlich "großzügiges" 60) bricht SSE sobald
    // ein Client den Tab im Hintergrund hat (kein Heartbeat-Read auf
    // Browser-Seite, Idle-Timer feuert).
    const opts = buildBunServeOptions(0, () => new Response("ok"));
    expect(opts.idleTimeout).toBe(0);
  });

  test("port wird 1:1 durchgereicht, fetch reicht req + Socket-Adresse an den Handler weiter", async () => {
    let received: [Request, string | undefined] | undefined;
    const fetchHandler = (req: Request, socketAddress?: string) => {
      received = [req, socketAddress];
      return new Response("test");
    };
    const opts = buildBunServeOptions(3000, fetchHandler);
    expect(opts.port).toBe(3000);
    const req = new Request("http://localhost/");
    const fakeServer = { requestIP: () => ({ address: "203.0.113.1", port: 1, family: "IPv4" }) };
    await opts.fetch(req, fakeServer as unknown as Bun.Server<unknown>);
    expect(received?.[0]).toBe(req);
    expect(received?.[1]).toBe("203.0.113.1");
  });

  test("maxRequestBodySize defaults well below Bun's own 128 MiB", () => {
    // Bun.serve's undocumented-in-our-code default (128 MiB) buffers every
    // concurrent request up to that size before any app-level body-limit
    // middleware runs. Pins the lowered default against a silent revert to
    // "just let Bun handle it".
    const opts = buildBunServeOptions(0, () => new Response("ok"));
    expect(opts.maxRequestBodySize).toBe(DEFAULT_MAX_REQUEST_BODY_SIZE_BYTES);
    expect(opts.maxRequestBodySize).toBeLessThan(128 * 1024 * 1024);
  });

  test("maxRequestBodySize is overridable for apps with larger maxUploadSize", () => {
    const opts = buildBunServeOptions(0, () => new Response("ok"), 64 * 1024 * 1024);
    expect(opts.maxRequestBodySize).toBe(64 * 1024 * 1024);
  });
});

describe("resolveDerivedMaxRequestBodySize", () => {
  test("stays above the files route's own derived bodyLimit", () => {
    // Otherwise Bun's bare rejection would fire before the route's own,
    // more specific 413 ever runs.
    const registry = createRegistry([createFilesFeature({ maxUploadSize: "50mb" })]);
    const routeBodyLimit = resolveMaxUploadBodyBytes({ registry, maxUploadSize: "50mb" });
    expect(resolveDerivedMaxRequestBodySize(registry)).toBeGreaterThan(routeBodyLimit);
  });

  test("accounts for a field maxSize configured above the global default", () => {
    const entity = createEntity({
      fields: { attachment: createFileField({ maxSize: "50mb" }) },
    });
    const feature = defineFeature("attachments", (r) => r.entity("attachment", entity));
    const registry = createRegistry([feature, createFilesFeature()]);
    expect(resolveDerivedMaxRequestBodySize(registry)).toBeGreaterThanOrEqual(50 * 1024 * 1024);
  });
});

describe("SSE heartbeat cadence", () => {
  test("liegt unter dem strengsten Edge-Idle-Timeout (Cloudflare 100s)", () => {
    // Bun.serve idleTimeout ist disabled (siehe buildBunServeOptions),
    // damit fällt der Bun-default-10s-Layer raus. Die strengsten
    // verbleibenden Layer sind CDN/LB-Edges:
    //   - Cloudflare Edge: 100 s   ← strengster realistischer Layer
    //   - AWS ALB: 60 s
    //   - Nginx default: keep-alive 60 s, aber nicht für Streams
    // Heartbeat muss DEUTLICH darunter liegen damit auch ein verschluckter
    // Frame nicht zur Connection-Death führt — Faktor 5 ist konservativ.
    expect(SSE_HEARTBEAT_INTERVAL_MS).toBeLessThan(60_000);
  });

  test("liegt nicht zu hoch — DefenseInDepth gegen Bun-Default-Drift", () => {
    // Wenn jemand idleTimeout: 0 wieder rausnimmt (Audit, Linter,
    // Misverständnis), darf der Heartbeat nicht der einzige
    // Schutzwall sein der unter dem 10s-Bun-default liegt. ≤30s
    // gibt Cushion + bleibt deutlich unter Bun-default-10s × 3.
    expect(SSE_HEARTBEAT_INTERVAL_MS).toBeLessThanOrEqual(30_000);
  });

  test("ist >= 5 s — Frequency-Wall gegen versehentliches Network-Spam", () => {
    // 1000 anonyme Viewer × Heartbeat-Frequency darf den Server nicht
    // mit Frames fluten. 5s = 200 frames/s pro 1000 Clients ist OK.
    // Unter 5s wäre eher ein "tippfehler" als bewusste Wahl.
    expect(SSE_HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(5_000);
  });
});
