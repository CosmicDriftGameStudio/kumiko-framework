import { describe, expect, test } from "bun:test";
import { NON_PUBLIC_API_PATHS, PUBLIC_API_PATHS, Routes } from "../api-constants";

// PUBLIC_API_PATHS is an allowlist: a missing entry (typo, forgotten route)
// fails CLOSED — the route stays behind auth, never accidentally public.
// But the classification itself must be total, or a route silently falls
// into a third, unchecked state that nobody notices until it's either
// exploited (should've been non-public) or reported broken by a client
// (should've been public). This test forces every `Routes` entry into
// exactly one of the two sets, in both directions:
//   - every Routes entry has a classification (no silent gap)
//   - every classified path still corresponds to a real Routes entry (no
//     stale/typo'd literal drifting out of sync with Routes)
function classifyRoutes(routes: Record<string, string>): {
  unclassified: string[];
  classifiedInBoth: string[];
} {
  const unclassified: string[] = [];
  const classifiedInBoth: string[] = [];

  for (const routePath of Object.values(routes)) {
    const apiPath = `/api${routePath}`;
    const isPublic = PUBLIC_API_PATHS.has(apiPath);
    const isNonPublic = NON_PUBLIC_API_PATHS.has(apiPath);
    if (isPublic && isNonPublic) classifiedInBoth.push(apiPath);
    else if (!isPublic && !isNonPublic) unclassified.push(apiPath);
  }

  return { unclassified, classifiedInBoth };
}

describe("Routes / PUBLIC_API_PATHS classification completeness", () => {
  test("every Routes entry is classified as exactly public XOR non-public", () => {
    const { unclassified, classifiedInBoth } = classifyRoutes(Routes);

    expect(unclassified).toEqual([]);
    expect(classifiedInBoth).toEqual([]);
  });

  test("every PUBLIC_API_PATHS / NON_PUBLIC_API_PATHS entry maps back to a real Routes value", () => {
    const knownApiPaths = new Set(Object.values(Routes).map((routePath) => `/api${routePath}`));

    const stalePublic = [...PUBLIC_API_PATHS].filter((path) => !knownApiPaths.has(path));
    const staleNonPublic = [...NON_PUBLIC_API_PATHS].filter((path) => !knownApiPaths.has(path));

    expect(stalePublic).toEqual([]);
    expect(staleNonPublic).toEqual([]);
  });

  // Regression guard for the mechanism itself: proves the completeness
  // check actually fails when a route is added without a classification,
  // rather than the two tests above being vacuously true by construction.
  test("regression: an unclassified route is detected", () => {
    const routesWithGap = {
      ...Routes,
      newFeature: "/new-feature-without-classification",
    };

    const { unclassified } = classifyRoutes(routesWithGap);

    expect(unclassified).toEqual(["/api/new-feature-without-classification"]);
  });
});
