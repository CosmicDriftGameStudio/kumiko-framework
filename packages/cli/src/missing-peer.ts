const APP_PEER_PACKAGES = [
  "@cosmicdrift/kumiko-framework",
  "@cosmicdrift/kumiko-bundled-features",
  "@cosmicdrift/kumiko-headless",
] as const;

// The runtime packages are optional peers (so `new app` runs without them); a
// command that needs one must report the missing install, not a resolver stacktrace.
// A subpath miss means the package is installed but too old for the requested export.
export function missingPeerMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (!/cannot find (package|module)/i.test(error.message)) return undefined;
  for (const peer of APP_PEER_PACKAGES) {
    if (error.message.includes(`'${peer}'`)) {
      return `${peer} is not installed. Install ${peer} in your app (bun add ${peer}).`;
    }
    const subpath = error.message.match(new RegExp(`'${peer}(/[^']*)'`))?.[1];
    if (subpath !== undefined) {
      return `Installed ${peer} lacks ${subpath.slice(1)}. Upgrade ${peer} in your app.`;
    }
  }
  return undefined;
}
