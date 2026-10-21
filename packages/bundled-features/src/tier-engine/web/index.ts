// Public exports for the browser side of the tier-engine feature. Import via
// `@cosmicdrift/kumiko-bundled-features/tier-engine/web` — the server side
// (createTierEngineFeature) is under
// `@cosmicdrift/kumiko-bundled-features/tier-engine` and has no React deps.

export { type TierEngineClientOptions, tierEngineClient } from "./client-plugin.tsx";
