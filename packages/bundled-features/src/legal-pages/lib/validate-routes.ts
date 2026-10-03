import type { LegalPageRoute } from "../constants.js";

// Validated once at feature-build time (not per-request) so a config typo
// fails app startup instead of surfacing as a confusing 404 later.
export function validateRoutes(routes: readonly LegalPageRoute[]): void {
  const seenPaths = new Set<string>();
  for (const route of routes) {
    if (!route.path || !route.slug || !route.lang) {
      throw new Error(
        `legal-pages: route is missing a required field (path/slug/lang): ${JSON.stringify(route)}`,
      );
    }
    if (!route.path.startsWith("/")) {
      throw new Error(`legal-pages: route path must start with "/", got "${route.path}"`);
    }
    if (seenPaths.has(route.path)) {
      throw new Error(`legal-pages: duplicate route path "${route.path}"`);
    }
    seenPaths.add(route.path);
  }
}
