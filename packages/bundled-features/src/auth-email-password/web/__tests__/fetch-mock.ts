import { afterEach, beforeEach, mock } from "bun:test";

/** Install a default 200-OK fetch mock; restores the pristine global after each test. */
export function installFetchMock(): void {
  const pristine = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = pristine;
  });
}
