// basePath mounts an app under a URL prefix (for example, `/admin`). Pure helpers shared by the
// browser nav adapter and the auth pages, which sit outside the NavProvider.

export function normalizeBasePath(raw: string | undefined): string {
  if (raw === undefined || raw === "" || raw === "/") return "";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}

// Returns the in-app (basePath-relative) path when `path` is under basePath; otherwise
// `undefined`. The segment boundary is strict: "/administrator" does not match "/admin".
export function stripBasePath(path: string, basePath: string): string | undefined {
  if (basePath === "") return path;
  if (path === basePath) return "/";
  if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length);
  return undefined;
}

export function prependBasePath(path: string, basePath: string): string {
  if (basePath === "") return path;
  // An in-app path is absolute: "/" or "/screen-id" or "/screen-id/entity-id". "/" becomes basePath.
  if (path === "/" || path === "") return basePath;
  return `${basePath}${path}`;
}
