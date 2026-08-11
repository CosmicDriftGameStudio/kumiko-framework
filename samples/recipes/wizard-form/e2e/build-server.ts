// Tiny Bun-Server der das e2e-Bundle baut und ausliefert — Pendant zum
// build-server in packages/renderer-web/e2e, radikal abgespeckt (kein
// Postgres, kein Tailwind, keine Auth). Der MockDispatcher (fixtures/
// mock-dispatcher.ts) ersetzt den Stack komplett.
//
// Unterschied zum renderer-web-Vorbild: das AppSchema wird NICHT im
// Client-Bundle dupliziert (Drift-Risiko gegen den echten Feature-Code).
// Stattdessen baut dieser Server-Prozess das Schema aus dem echten
// src/feature.ts über createRegistry + buildAppSchema (beide pure, kein
// DB/HTTP) und serviert es als JSON über /schema.json — client.tsx fetched
// es beim Boot. So bleibt serverseitiger Framework-Code (defineFeature,
// r.crud, r.screen) aus dem Browser-Bundle raus.
//
// Port 4188: 4172-4181/4186 sind von anderen samples/apps belegt (siehe
// deren playwright.config.ts/package.json), 4188 ist frei.

import { resolve } from "node:path";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { formDraftFeature } from "@cosmicdrift/kumiko-bundled-features/form-draft";
import { buildAppSchema, createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { listingsFeature } from "../src/feature";

const HERE = resolve(import.meta.dir);
const ENTRY = resolve(HERE, "fixtures/client.tsx");
const HTML_PATH = resolve(HERE, "fixtures/index.html");

const port = Number(process.env["PORT"] ?? 4188);

const registry = createRegistry([listingsFeature, formDraftFeature, createConfigFeature()]);
const schema = buildAppSchema(registry);
const schemaJson = JSON.stringify(schema);

const built = await Bun.build({
  entrypoints: [ENTRY],
  target: "browser",
  sourcemap: "linked",
});

if (!built.success) {
  // biome-ignore lint/suspicious/noConsole: e2e build script — no logger wired
  for (const log of built.logs) console.error(log);
  throw new Error("wizard-form/e2e: client bundle failed");
}

const jsOutput = built.outputs.find((o) => o.path.endsWith(".js"));
const mapOutput = built.outputs.find((o) => o.path.endsWith(".js.map"));
if (!jsOutput) throw new Error("wizard-form/e2e: bundle has no .js output");

const js = await jsOutput.text();
const map = mapOutput ? await mapOutput.text() : "";
const html = await Bun.file(HTML_PATH).text();

Bun.serve({
  port,
  fetch(req: Request): Response {
    const url = new URL(req.url);
    if (url.pathname === "/client.js") {
      return new Response(js, {
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
      });
    }
    if (url.pathname === "/client.js.map") {
      return new Response(map, { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    if (url.pathname === "/schema.json") {
      return new Response(schemaJson, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    if (url.pathname === "/styles.css") {
      // Stub — keine Tailwind-Pipeline. Spec-Asserts halten sich an
      // ARIA/text/role/testid statt visueller CSS-States.
      return new Response("", { headers: { "Content-Type": "text/css; charset=utf-8" } });
    }
    if (url.pathname === "/api/sse" || url.pathname.startsWith("/sse")) {
      // Long-lived Empty-Stream falls irgendein Primitive/Hook doch eine
      // EventSource öffnet — ohne korrekte SSE-Antwort gibt's eine
      // "MIME type text/html"-Console-Error statt eines sauberen No-Ops.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(": connected\n\n"));
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
});

// biome-ignore lint/suspicious/noConsole: e2e build script — no logger wired
console.log(`wizard-form/e2e build-server listening on http://localhost:${port}`);
