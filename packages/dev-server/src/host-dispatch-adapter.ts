import { join } from "node:path";
import type {
  HostRoutingDispatchFn,
  HostRoutingDispatchResult,
} from "@cosmicdrift/kumiko-bundled-features/host-routing";
import type { DevHostDispatch, DevHostDispatchResult } from "./create-kumiko-server.js";

export type ToDevHostDispatchOptions = {
  // Prod HTML file → dev client-entry name. Files listed here get the live
  // bundle; all others are served verbatim from `staticDir`.
  readonly entries?: Readonly<Record<string, string>>;
  // Directory holding the prod HTML files, relative to the dev-server CWD.
  readonly staticDir: string;
};

// Runs the prod host-routing decision in the dev server, so dev and prod
// cannot route differently. Per-host CSP is a prod concern and dropped here.
export function toDevHostDispatch(
  dispatch: HostRoutingDispatchFn,
  options: ToDevHostDispatchOptions,
): DevHostDispatch {
  const entries = options.entries ?? {};
  const toDev = (result: HostRoutingDispatchResult): DevHostDispatchResult => {
    switch (result.kind) {
      case "redirect":
        return result;
      case "html": {
        const entryName = entries[result.file];
        return entryName === undefined
          ? { kind: "static-html", file: join(options.staticDir, result.file) }
          : { kind: "html", entryName };
      }
      case "not-found": {
        if (result.file === undefined) return { kind: "not-found" };
        const entryName = entries[result.file];
        return entryName === undefined
          ? { kind: "not-found", file: join(options.staticDir, result.file) }
          : { kind: "not-found", entryName };
      }
    }
  };
  return async (req, deps) => {
    const url = new URL(req.url);
    const host = req.headers.get("host") ?? url.host;
    return toDev(await dispatch({ host, path: url.pathname, search: url.search }, deps));
  };
}
