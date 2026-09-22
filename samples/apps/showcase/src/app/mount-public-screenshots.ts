// ponytail: dev-server serves only index.html from public/ — static siblings need an explicit ExtraRoute.

import { existsSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtraRouteDefinition } from "@cosmicdrift/kumiko-framework/api";
import type { Context } from "hono";

const SCREENSHOTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../public/screenshots",
);

export const publicScreenshotsRoute: ExtraRouteDefinition = {
  method: "GET",
  path: "/screenshots/:name",
  entry: "anonymous",
  handler: (c: Context): Response | Promise<Response> => {
    const name = c.req.param("name");
    if (!name || name.includes("..") || name.includes("/")) return c.notFound();
    const path = resolve(SCREENSHOTS_DIR, name);
    if (!path.startsWith(SCREENSHOTS_DIR + sep) || !existsSync(path)) return c.notFound();
    const file = Bun.file(path);
    return new Response(file);
  },
};
