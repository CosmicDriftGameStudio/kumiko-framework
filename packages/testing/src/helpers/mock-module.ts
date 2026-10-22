import { afterAll, mock } from "bun:test";

/**
 * Mocks `specifier` with the real exports plus `overrides` and restores the real module in
 * `afterAll`: bun's mock.module is process-global, so a leaked mock breaks later files of a
 * shared DOM run. Pass the namespace imported before mocking; it is copied here because
 * mock.module patches an already imported namespace in place. A relative specifier must be
 * absolute (resolve it against the test file), since mock.module resolves it from this file.
 *
 * `restoreOverrides` fixes up modules that re-export a mocked binding: their copy was taken
 * under the mock and holds the spy, so it must be pointed back at the real export.
 */
export function mockModuleForFile(
  specifier: string,
  realModule: object,
  overrides: Readonly<Record<string, unknown>>,
  options: { readonly restoreOverrides?: Readonly<Record<string, unknown>> } = {},
): void {
  const real = { ...realModule };
  mock.module(specifier, () => ({ ...real, ...overrides }));
  afterAll(() => {
    mock.module(specifier, () => ({ ...real, ...options.restoreOverrides }));
  });
}
