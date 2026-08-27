// Tiny Bun server that builds and serves the e2e bundle — counterpart to
// the build-server in packages/renderer-web/e2e, radically stripped down
// (no Postgres, no auth). The MockDispatcher (fixtures/mock-dispatcher.ts)
// replaces the whole stack.
//
// Difference from the renderer-web blueprint: the AppSchema is NOT
// duplicated in the client bundle (drift risk against the real feature
// code). Instead this server process builds the schema from the real
// src/feature.ts via createRegistry + buildAppSchema (both pure, no
// DB/HTTP) and serves it as JSON over /schema.json — client.tsx fetches
// it on boot. That keeps server-side framework code (defineFeature,
// r.crud, r.screen) out of the browser bundle.
//
// Port 4188: 4172-4181/4186 are taken by other samples/apps (see their
// playwright.config.ts/package.json), 4188 is free.
//
// /styles.css is REALLY compiled from Tailwind (not stubbed) — the
// 375px-viewport specs (wizard-mobile.spec.ts) check real layout
// properties (overlap, horizontal overflow, whether the Next button
// disappears under the simulated keyboard). Without real CSS those would
// be fake assertions against unstyled browser default flow. Entry
// stylesheet = fixtures/styles.css, a local wrapper that re-exports
// renderer-web's styles.css and adds an @source covering this e2e dir —
// renderer-web's own @source globs only scan samples/**/src/**, which
// misses e2e/fixtures/client.tsx.
// One-shot build, no watcher (the server only runs for the test duration)
// — same CLI-resolve mechanism as create-kumiko-server.ts, but without
// its non-fatal degradation: if the CLI is missing or the build fails,
// the server must die hard instead of serving an empty stylesheet stub
// and letting the layout assertions pass vacuously.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { formDraftFeature } from "@cosmicdrift/kumiko-bundled-features/form-draft";
import { buildAppSchema, createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import {
  canResolveTailwindStylesheet,
  resolveTailwindCli,
} from "@cosmicdrift/kumiko-server-runtime/resolve-tailwind-cli";
import { listingsFeature } from "../src/feature";

const HERE = resolve(import.meta.dir);
const ENTRY = resolve(HERE, "fixtures/client.tsx");
const HTML_PATH = resolve(HERE, "fixtures/index.html");

async function buildStylesheet(): Promise<string> {
  const cliPath = resolveTailwindCli({ bun: Bun, cwd: HERE });
  if (cliPath === undefined) {
    throw new Error(
      "wizard-form/e2e: @tailwindcss/cli not resolvable — run `bun install` at the repo root.",
    );
  }
  const entryCss = resolve(HERE, "fixtures/styles.css");
  if (!canResolveTailwindStylesheet(entryCss, { bun: Bun, cwd: HERE })) {
    throw new Error(
      `wizard-form/e2e: tailwindcss not resolvable for ${entryCss} — peer dependency missing at the stylesheet's location.`,
    );
  }
  const outDir = mkdtempSync(join(tmpdir(), "wizard-form-e2e-tw-"));
  try {
    const outPath = join(outDir, "styles.css");
    const bunBin = process.argv[0] ?? "bun";
    const build = Bun.spawnSync([bunBin, "run", cliPath, "-i", entryCss, "-o", outPath], {
      cwd: HERE,
    });
    if (!build.success) {
      throw new Error(
        `wizard-form/e2e: tailwind build failed (exit ${build.exitCode})\n${build.stderr.toString()}`,
      );
    }
    return await Bun.file(outPath).text();
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const css = await buildStylesheet();

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
      return new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8" } });
    }
    if (url.pathname === "/api/sse" || url.pathname.startsWith("/sse")) {
      // Long-lived empty stream in case some primitive/hook opens an
      // EventSource after all — without a correct SSE response this
      // would produce a "MIME type text/html" console error instead of a
      // clean no-op.
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
