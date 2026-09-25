// Class budget for every app: solon's 30s/5s flows run 4-parallel today; webServer is the
// slowest sample boot (Bun.build + Tailwind), poll is phronexsis's 15s projection wait.
// `real` covers solon's document-onboarding real-provider flow (240s), the slowest
// consumer today — apps no longer set test.setTimeout/describe.configure for real runs.
export const E2E_TIMEOUT_MS = {
  test: 30_000,
  expect: 5_000,
  action: 5_000,
  navigation: 10_000,
  poll: 15_000,
  webServer: 90_000,
  real: 240_000,
} as const;
