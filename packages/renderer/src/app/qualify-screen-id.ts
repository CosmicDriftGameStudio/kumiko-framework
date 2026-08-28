// Dependency-free: kumiko-screen.tsx already imports useNav from nav.tsx, so
// this can't live in either without a cycle. Form must match the registry's
// qualification rule (packages/framework/src/engine/qualified-name.ts).
export function qualifyScreenId(featureName: string, screenId: string): string {
  return `${featureName}:screen:${screenId}`;
}

// Inverse of qualifyScreenId. A short id ("task-list") has no feature
// segment and returns undefined — callers need that to tell "this redirect
// names a feature" apart from "this redirect is feature-less, resolve by
// short id alone" (fw#2485).
export function featureNameFromQualifiedScreenId(id: string): string | undefined {
  const parts = id.split(":");
  return parts.length === 3 && parts[1] === "screen" ? parts[0] : undefined;
}
