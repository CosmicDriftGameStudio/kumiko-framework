const APP_PEER_PACKAGES = [
  "@cosmicdrift/kumiko-framework",
  "@cosmicdrift/kumiko-bundled-features",
] as const;

// The runtime packages are optional peers (so `new app` runs without them); a
// command that needs one must report the missing install, not a resolver stacktrace.
export function missingPeerMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  for (const peer of APP_PEER_PACKAGES) {
    if (error.message.includes(`'${peer}`) && /cannot find (package|module)/i.test(error.message)) {
      return `${peer} is not installed. Install ${peer} in your app (bun add ${peer}).`;
    }
  }
  return undefined;
}
