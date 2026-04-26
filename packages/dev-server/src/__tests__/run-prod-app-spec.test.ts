// Spec-Tests für die Bun.serve-Options + Heartbeat-Cadence. Diese
// Konstanten/Defaults haben Live-Bugs verursacht und sind 1-Zeile-
// revertierbar — die Tests pinsen Intent + akzeptablen Range gegen
// "looks like a leak"-Reverts oder "bisschen rauf, sollte reichen"-
// Tweaks.

import { describe, expect, test } from "vitest";
import { SSE_HEARTBEAT_INTERVAL_MS } from "@kumiko/framework/api";
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

  test("port + fetch werden 1:1 durchgereicht", () => {
    const fetchHandler = (_req: Request) => new Response("test");
    const opts = buildBunServeOptions(3000, fetchHandler);
    expect(opts.port).toBe(3000);
    expect(opts.fetch).toBe(fetchHandler);
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
