import { expect } from "@playwright/test";
import type { BoundApi } from "../seed-types";
import { E2E_TIMEOUT_MS } from "./timeouts";

export async function waitForProjection<T>(
  read: () => Promise<T>,
  isReady: (value: T) => boolean,
  message = "waitForProjection: condition never became true",
): Promise<T> {
  let ready: { readonly value: T } | undefined;
  await expect
    .poll(
      async () => {
        const value = await read();
        if (isReady(value)) ready = { value };
        return ready !== undefined;
      },
      { message, timeout: E2E_TIMEOUT_MS.poll },
    )
    .toBe(true);
  if (ready === undefined) throw new Error(message);
  return ready.value;
}

export async function pollForRow<TRow extends { readonly id: string } = { readonly id: string }>(
  api: Pick<BoundApi, "queryOk">,
  queryType: string,
  predicate: (row: TRow) => boolean,
  payload: unknown = {},
): Promise<TRow> {
  const rows = await waitForProjection(
    async () => (await api.queryOk<{ readonly rows: readonly TRow[] }>(queryType, payload)).rows,
    (candidates) => candidates.some(predicate),
    `pollForRow: no row of "${queryType}" matched the predicate`,
  );
  const row = rows.find(predicate);
  if (row === undefined) throw new Error(`pollForRow: no row of "${queryType}" matched`);
  return row;
}
