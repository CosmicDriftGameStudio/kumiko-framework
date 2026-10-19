import type { AnonymousExtraRoute } from "@cosmicdrift/kumiko-framework/api";
import { readStaticFile, serveDiskFile } from "./run-prod-app-static-files.ts";

export type DiskFileRouteOptions = {
  /** Route path containing the `:file` parameter, e.g. `/fonts/:file`. */
  readonly path: string;
  /** Maps a plain file name to an absolute disk path, or null to answer 404. Only one
   *  segment without a leading dot or separator gets here; anything else is 404 already. */
  readonly resolveFile: (requestedFile: string) => string | null;
};

// Hono percent-decodes the param, so `..%2F` arrives as `../`; a leading dot also
// covers `.`, `..` and dotfiles such as `.env` next to the served files.
function isPlainFileName(name: string): boolean {
  return name.length > 0 && !name.startsWith(".") && !/[/\\\0]/.test(name);
}

export function diskFileRoute(options: DiskFileRouteOptions): AnonymousExtraRoute {
  if (!options.path.includes(":file")) {
    throw new Error(`diskFileRoute: path "${options.path}" must contain the ":file" parameter`);
  }
  return {
    method: "GET",
    path: options.path,
    entry: "anonymous",
    handler: async (c) => {
      const requestedFile = c.req.param("file") ?? "";
      if (!isPlainFileName(requestedFile)) return c.notFound();
      const filePath = options.resolveFile(requestedFile);
      if (filePath === null) return c.notFound();
      const file = await readStaticFile(filePath);
      if (!file) return c.notFound();
      return serveDiskFile(c.req.raw, c.req.path, file);
    },
  };
}
