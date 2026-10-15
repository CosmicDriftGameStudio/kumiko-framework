// Bun.serve entry-point.
//
// Local:
//   PUPPETEER_AUTH_TOKEN=$(openssl rand -hex 32) bun run src/index.ts
//
// In K8s: Helm chart sets env-vars via Secret + ConfigMap.

import { loadConfig } from "./config";
import { shutdownBrowser } from "./render";
import { createApp } from "./server";

const config = loadConfig();
const { app } = createApp(config);

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

// biome-ignore lint/suspicious/noConsole: server startup log
console.log(
  `[puppeteer-service] listening on :${server.port} ` +
    `(timeout=${config.renderTimeoutMs}ms, maxHtml=${config.maxHtmlBytes}b)`,
);

// Graceful shutdown — releases the browser on SIGTERM (K8s rolling update).
const shutdown = async (signal: string) => {
  // biome-ignore lint/suspicious/noConsole: shutdown log
  console.log(`[puppeteer-service] ${signal} — shutting down`);
  await shutdownBrowser();
  server.stop();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
