import { buildSharedAuthRoutes } from "@cosmicdrift/kumiko-server-runtime/boot/shared-boot-steps";
import type { CreateKumikoServerOptions } from "./create-kumiko-server.ts";
import type { RunDevAppOptions } from "./run-dev-app.ts";
import type { DevAuthWiring } from "./run-dev-app-auth.ts";
import type { DevBootConfig } from "./run-dev-app-config.ts";

export type DevServerOptions = Omit<CreateKumikoServerOptions, "onAfterSetup">;

function pickDevClientOptions(options: RunDevAppOptions) {
  return {
    ...(options.clientEntry !== undefined && { clientEntry: options.clientEntry }),
    ...(options.errorDocs && { errorDocs: options.errorDocs }),
    ...(options.rowLevelSecurity !== undefined && { rowLevelSecurity: options.rowLevelSecurity }),
    ...(options.clientEntries !== undefined && { clientEntries: options.clientEntries }),
    ...(options.hostDispatch !== undefined && { hostDispatch: options.hostDispatch }),
    ...(options.resolvePageHead !== undefined && { resolvePageHead: options.resolvePageHead }),
    ...(options.stylesheet !== undefined && { stylesheet: options.stylesheet }),
    ...(options.stylesheetWatch !== undefined && { stylesheetWatch: options.stylesheetWatch }),
    ...(options.htmlPath !== undefined && { htmlPath: options.htmlPath }),
    ...(options.port !== undefined && { port: options.port }),
    ...(options.watchDirs !== undefined && { watchDirs: options.watchDirs }),
    ...(options.installSignalHandlers !== undefined && {
      installSignalHandlers: options.installSignalHandlers,
    }),
  };
}

function pickDevServiceOptions(options: RunDevAppOptions) {
  return {
    ...(options.anonymousAccess !== undefined && { anonymousAccess: options.anonymousAccess }),
    ...(options.files !== undefined && { files: options.files }),
    ...(options.wire !== undefined && { wire: options.wire }),
  };
}

export function buildDevServerOptions(deps: {
  readonly options: RunDevAppOptions;
  readonly config: DevBootConfig;
  readonly auth: DevAuthWiring;
  readonly extraContext: CreateKumikoServerOptions["extraContext"];
  readonly trustedProxyHops: number | undefined;
  readonly effectiveFeatures: CreateKumikoServerOptions["effectiveFeatures"];
}): DevServerOptions {
  const { options, config, auth, extraContext, trustedProxyHops, effectiveFeatures } = deps;
  const { effectiveAuth, extraRoutes, wiring } = config;
  return {
    features: config.features,
    ...pickDevClientOptions(options),
    ...(extraContext !== undefined && { extraContext }),
    ...pickDevServiceOptions(options),
    ...(extraRoutes !== undefined && { extraRoutes }),
    ...(trustedProxyHops !== undefined && { trustedProxyHops }),
    ...(options.demoMode && { wrapFetch: wiring.wrapFetch }),
    ...(effectiveFeatures !== undefined && { effectiveFeatures }),
    ...(effectiveAuth && {
      auth: {
        ...buildSharedAuthRoutes(effectiveAuth, Boolean(auth.mfaFeature)),
        ...(effectiveAuth.trustedProxyHops !== undefined && {
          trustedProxyHops: effectiveAuth.trustedProxyHops,
        }),
        ...auth.sessionAuthFragment,
        ...auth.patAuthFragment,
      },
    }),
  };
}
