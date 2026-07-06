// ponytail: dev-server serves only index.html from public/ — static siblings need an explicit Hono route.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";

const SCREENSHOTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../public/screenshots",
);

export function mountPublicScreenshots(app: Hono): void {
  app.get("/screenshots/:name", (c) => {
    const name = c.req.param("name");
    if (!name || name.includes("..") || name.includes("/")) return c.notFound();
    const path = resolve(SCREENSHOTS_DIR, name);
    if (!path.startsWith(SCREENSHOTS_DIR) || !existsSync(path)) return c.notFound();
    return c.body(Bun.file(path));
  });
}
