// Tiny Bun-Server der das e2e-Bundle baut und ausliefert. Pendant zum
// dev-server in @cosmicdrift/kumiko-dev-server, aber radikal abgespeckt — kein
// Postgres, keine Auth, keine Schema-Injection; Tailwind läuft einmal beim
// Start (Layout-Specs messen echte Boxen). Reicht
// für renderer/e2e weil:
//   - der MockDispatcher den Stack komplett ersetzt
//   - das AppSchema explizit an createKumikoApp übergeben wird

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HERE = resolve(import.meta.dir);
const ENTRY = resolve(HERE, "fixtures/client.tsx");
const HTML_PATH = resolve(HERE, "fixtures/index.html");
const STYLES_ENTRY = resolve(HERE, "../src/web/styles.css");

const port = Number(process.env["PORT"] ?? 4176);

const built = await Bun.build({
  entrypoints: [ENTRY],
  target: "browser",
  // Sourcemap für lesbare Stack-Traces wenn Playwright-Tests fail'n.
  sourcemap: "linked",
});

if (!built.success) {
  // biome-ignore lint/suspicious/noConsole: e2e build script — no logger wired
  for (const log of built.logs) console.error(log);
  throw new Error("renderer/e2e: client bundle failed");
}

const jsOutput = built.outputs.find((o) => o.path.endsWith(".js"));
const mapOutput = built.outputs.find((o) => o.path.endsWith(".js.map"));
if (!jsOutput) throw new Error("renderer/e2e: bundle has no .js output");

// Layout specs (mobile overflow) measure real boxes, so the stylesheet must be
// the real Tailwind output of the renderer/web theme, not an empty stub.
async function compileStyles(): Promise<string> {
  const cliPath = Bun.resolveSync("@tailwindcss/cli/package.json", HERE).replace(
    "package.json",
    "dist/index.mjs",
  );
  const outDir = await mkdtemp(join(tmpdir(), "renderer-e2e-css-"));
  const outFile = join(outDir, "styles.css");
  try {
    const proc = Bun.spawn([process.execPath, cliPath, "-i", STYLES_ENTRY, "-o", outFile], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await proc.exited) !== 0) throw new Error("renderer/e2e: tailwind build failed");
    return await readFile(outFile, "utf8");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

const css = await compileStyles();
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
    if (url.pathname === "/styles.css") {
      return new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8" } });
    }
    if (url.pathname === "/api/sse" || url.pathname.startsWith("/sse")) {
      // useQuery({ live: true }) öffnet eine EventSource auf /sse — ohne
      // korrekte SSE-Antwort kommt eine "MIME type text/html"-Console-
      // Error. Long-lived Empty-Stream: Connection bleibt offen, keine
      // Events, kein Reconnect-Loop.
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
console.log(`renderer/e2e build-server listening on http://localhost:${port}`);
