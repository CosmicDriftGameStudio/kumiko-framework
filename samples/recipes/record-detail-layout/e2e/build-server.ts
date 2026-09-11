// Tiny Bun server that builds and serves the e2e bundle — same shape as
// writeform-section/e2e/build-server.ts, radically stripped down (no
// Postgres, no auth). The MockDispatcher (fixtures/mock-dispatcher.ts)
// replaces the whole stack.
//
// The AppSchema is NOT duplicated in the client bundle (drift risk against
// the real feature code). Instead this server process builds the schema
// from the real src/feature.ts via createRegistry + buildAppSchema (both
// pure, no DB/HTTP) and serves it as JSON over /schema.json — client.tsx
// fetches it on boot.
//
// Port 4190: 4172-4189 are taken by other samples/apps (see their
// playwright.config.ts/package.json), 4190 is free.
//
// /styles.css is REALLY compiled from Tailwind (not stubbed) — this recipe
// exists to prove a real box-model fix (fw#2778: a relatedList tab panel
// must size to its content, not stretch to fill). Without real CSS the
// getBoundingClientRect() measurements in height.spec.ts would be against
// unstyled browser default flow, not the actual flex chain under test.
// Entry stylesheet = fixtures/styles.css, a local wrapper that re-exports
// renderer-web's styles.css and adds an @source covering this e2e dir.
//
// One-shot build, no watcher (the server only runs for the test duration)
// — dies hard on a Tailwind CLI/build failure instead of degrading to an
// empty stylesheet and letting the layout assertions pass vacuously.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildAppSchema, createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import {
  canResolveTailwindStylesheet,
  resolveTailwindCli,
} from "@cosmicdrift/kumiko-server-runtime/resolve-tailwind-cli";
import { createOrderDeskFeature } from "../src/feature";

const HERE = resolve(import.meta.dir);
const ENTRY = resolve(HERE, "fixtures/client.tsx");
const HTML_PATH = resolve(HERE, "fixtures/index.html");

async function buildStylesheet(): Promise<string> {
  const cliPath = resolveTailwindCli({ bun: Bun, cwd: HERE });
  if (cliPath === undefined) {
    throw new Error(
      "record-detail-layout/e2e: @tailwindcss/cli not resolvable — run `bun install` at the repo root.",
    );
  }
  const entryCss = resolve(HERE, "fixtures/styles.css");
  if (!canResolveTailwindStylesheet(entryCss, { bun: Bun, cwd: HERE })) {
    throw new Error(
      `record-detail-layout/e2e: tailwindcss not resolvable for ${entryCss} — peer dependency missing at the stylesheet's location.`,
    );
  }
  const outDir = mkdtempSync(join(tmpdir(), "record-detail-layout-e2e-tw-"));
  try {
    const outPath = join(outDir, "styles.css");
    const bunBin = process.argv[0] ?? "bun";
    const build = Bun.spawnSync([bunBin, "run", cliPath, "-i", entryCss, "-o", outPath], {
      cwd: HERE,
    });
    if (!build.success) {
      throw new Error(
        `record-detail-layout/e2e: tailwind build failed (exit ${build.exitCode})\n${build.stderr.toString()}`,
      );
    }
    return await Bun.file(outPath).text();
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const css = await buildStylesheet();

const port = Number(process.env["PORT"] ?? 4190);

const registry = createRegistry([createOrderDeskFeature()]);
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
  throw new Error("record-detail-layout/e2e: client bundle failed");
}

const jsOutput = built.outputs.find((o) => o.path.endsWith(".js"));
const mapOutput = built.outputs.find((o) => o.path.endsWith(".js.map"));
if (!jsOutput) throw new Error("record-detail-layout/e2e: bundle has no .js output");

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
      return new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8" } });
    }
    if (url.pathname === "/api/sse" || url.pathname.startsWith("/sse")) {
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
console.log(`record-detail-layout/e2e build-server listening on http://localhost:${port}`);
