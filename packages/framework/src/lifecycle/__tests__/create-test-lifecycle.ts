// Test helper: builds a minimal Lifecycle-shaped stub with selectively
// overridable methods. Lets unit tests focus on the one method under test
// without repeating an 8-field boilerplate that breaks silently when the
// Lifecycle interface grows.

import type { Lifecycle } from "../lifecycle";

export function createTestLifecycle(overrides: Partial<Lifecycle> = {}): Lifecycle {
  const defaults: Lifecycle = {
    state: () => "ready",
    uptimeSec: () => 0,
    markReady: () => {},
    onStateChange: () => () => {},
    registerShutdownHook: () => {},
    hookNames: () => [],
    drain: async () => {},
  };
  return { ...defaults, ...overrides };
}
