// The other trailing-slash form of a path, or null for the root path (it has
// no distinct variant).
export function slashVariantOf(path: string): string | null {
  if (path === "/") return null;
  return path.endsWith("/") ? path.slice(0, -1) : `${path}/`;
}

// Hono matches strictly, so the slash variant of a page would 404. A 301 keeps
// one canonical URL; the query string is carried over.
export function redirectToCanonicalPath(requestUrl: string, canonicalPath: string): Response {
  return new Response(null, {
    status: 301,
    headers: { location: `${canonicalPath}${new URL(requestUrl).search}` },
  });
}
