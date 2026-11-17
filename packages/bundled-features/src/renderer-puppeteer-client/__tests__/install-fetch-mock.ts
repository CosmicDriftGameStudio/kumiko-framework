import type { Mock } from "bun:test";

// Test-boundary cast: bun's `typeof fetch` requires `preconnect`, which the
// code under test never calls — a plain mock() is behaviourally sufficient.
export function installFetchMock(fetchMock: Mock<(...args: never[]) => unknown>): void {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}
