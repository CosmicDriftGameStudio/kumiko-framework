// The termination handlers hold the tenant's advisory lock across the provider call; without a
// bound a hanging provider would pin the transaction, its pool connection and every waiting
// withdrawal request. The abandoned call may still complete at the provider, so a timeout is
// reported like any provider error and the operator reconciles by hand.
export const PROVIDER_CALL_TIMEOUT_MS = 20_000;

export async function withProviderCallTimeout<T>(
  call: Promise<T>,
  timeoutMs: number = PROVIDER_CALL_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`provider call exceeded ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
