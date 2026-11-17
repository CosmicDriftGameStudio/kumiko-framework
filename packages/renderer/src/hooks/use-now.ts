import { useEffect, useState } from "react";
import { serverNowMs } from "../server-clock.ts";

function isTickInterval(intervalMs: number | null): intervalMs is number {
  return intervalMs !== null && Number.isFinite(intervalMs) && intervalMs > 0;
}

/** Server-aligned current time in epoch ms, refreshed every `intervalMs`; `null` or a non-positive interval holds the last value. */
export function useNow(intervalMs: number | null): number {
  const [nowMs, setNowMs] = useState(serverNowMs);
  useEffect(() => {
    // skip: clock paused, the last value stays
    if (!isTickInterval(intervalMs)) return;
    setNowMs(serverNowMs());
    const timer = setInterval(() => setNowMs(serverNowMs()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return nowMs;
}
