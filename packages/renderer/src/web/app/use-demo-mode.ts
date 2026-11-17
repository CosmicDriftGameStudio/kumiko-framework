import {
  DEMO_MODE_PATH,
  type DemoModePayload,
  demoModePayloadSchema,
} from "@cosmicdrift/kumiko-types/demo-mode-types";
import { useEffect, useState } from "react";

let cachedPayload: DemoModePayload | null = null;
let inflight: Promise<DemoModePayload | null> | null = null;

// Only a valid answer is cached for the page's lifetime: without a demoMode option the route
// 404s (dev), and an invalid body must not stick either.
function loadDemoMode(): Promise<DemoModePayload | null> {
  if (cachedPayload) return Promise.resolve(cachedPayload);
  inflight ??= fetch(DEMO_MODE_PATH)
    .then(async (res) => (res.ok ? demoModePayloadSchema.safeParse(await res.json()) : null))
    .then((parsed) => {
      if (!parsed?.success) return null;
      cachedPayload = parsed.data;
      return parsed.data;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// null while loading and when the server runs without demo mode; apps merge their own fallback.
export function useDemoMode(): DemoModePayload | null {
  const [payload, setPayload] = useState(cachedPayload);
  useEffect(() => {
    if (cachedPayload) return;
    let active = true;
    void loadDemoMode().then((loaded) => {
      if (active) setPayload(loaded);
    });
    return () => {
      active = false;
    };
  }, []);
  return payload;
}
