import { existsSync, realpathSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";

// GET/HEAD to a non-API, non-SSE path — the dispatch-worthy set shared by
// the SPA catch-all and the public/-file lookup (they split on whether the
// path has a dot).
export function isRoutableGetOrHead(req: Request, pathname: string): boolean {
  return (
    (req.method === "GET" || req.method === "HEAD") &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/sse")
  );
}

// Resolves a request pathname to a file inside publicDir, or undefined if
// it isn't one. Two traversal vectors, both must be blocked:
//   - literal ".." segments (new URL() already collapses these in
//     `pathname`, but resolve()+containment is checked regardless — no
//     path-safety may depend on caller behavior upstream).
//   - percent-encoded slashes (e.g. "%2e%2e%2f"): WHATWG URL parsing only
//     normalizes dot-segments that are delimited by a literal "/", so an
//     encoded slash survives into `pathname` untouched. decodeURIComponent
//     resolves it to "../" before the containment check runs.
function resolvePublicFilePath(pathname: string, publicDir: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  // A NUL byte makes readFile throw ERR_INVALID_ARG_VALUE (not ENOENT), which
  // would surface as a 500 instead of a router miss.
  if (decoded.includes("\0")) return undefined;
  const resolved = resolve(publicDir, `.${decoded}`);
  return resolved === publicDir || resolved.startsWith(publicDir + sep) ? resolved : undefined;
}

// Same extension → content-type mapping as prod's
// run-prod-app-static-files.ts#mimeTypeFor — that function isn't part of
// server-runtime's public exports (its own package.json "exports" map),
// so this is a small self-contained copy rather than a new cross-package
// export for one call site.
const PUBLIC_FILE_MIME_TYPES = new Map<string, string>([
  ["html", "text/html; charset=utf-8"],
  ["js", "text/javascript; charset=utf-8"],
  ["mjs", "text/javascript; charset=utf-8"],
  ["css", "text/css; charset=utf-8"],
  ["json", "application/json; charset=utf-8"],
  ["svg", "image/svg+xml"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["ico", "image/x-icon"],
  ["txt", "text/plain; charset=utf-8"],
  ["xml", "application/xml; charset=utf-8"],
  ["webmanifest", "application/manifest+json"],
  ["woff2", "font/woff2"],
]);

function publicFileMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";
  return PUBLIC_FILE_MIME_TYPES.get(ext) ?? "application/octet-stream";
}

// Reads a file under publicDir for the dev-server's static-asset fallback
// (dev-parity with prod's disk lookup in buildStaticFallback). undefined
// means "not a servable file here" — caller treats that as a router miss,
// same as ENOENT/EISDIR/ENOTDIR further down.
export async function servePublicFile(
  pathname: string,
  publicDir: string,
): Promise<{ readonly bytes: Uint8Array; readonly mime: string } | undefined> {
  const filePath = resolvePublicFilePath(pathname, publicDir);
  if (filePath === undefined) return undefined;
  try {
    // Lexical containment (above) only catches "..", not a symlink inside
    // publicDir that points outside it on disk — realpath resolves the
    // actual target and the same containment check runs against it. Read
    // from the resolved path so the checked target is the one read.
    const real = await realpath(filePath);
    if (real !== publicDir && !real.startsWith(publicDir + sep)) return undefined;
    const bytes = await readFile(real);
    return { bytes, mime: publicFileMimeType(filePath) };
  } catch (err) {
    const code = errorCodeOf(err);
    if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR" || code === "ENAMETOOLONG") {
      return undefined;
    }
    throw err;
  }
}

// App-root convention (same as the watchDirs patterns and resolveStylesheet):
// process.cwd() is the app workspace, so public/ is its static asset dir.
// Symlink-resolved once: servePublicFile compares realpath()s against it, so
// a symlinked public/ would otherwise 404 every file.
export function resolveDevPublicDir(): string {
  const lexicalPublicDir = resolve(process.cwd(), "public");
  return existsSync(lexicalPublicDir) ? realpathSync(lexicalPublicDir) : lexicalPublicDir;
}
