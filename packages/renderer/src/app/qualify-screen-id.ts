// Dependency-free: kumiko-screen.tsx already imports useNav from nav.tsx, so
// this can't live in either without a cycle. Form must match the registry's
// qualification rule (packages/framework/src/engine/qualified-name.ts).
export function qualifyScreenId(featureName: string, screenId: string): string {
  return `${featureName}:screen:${screenId}`;
}
