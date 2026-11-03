import { InternalError } from "@cosmicdrift/kumiko-framework/errors";

// Handlers that need a feature API wired through the app bootstrap's `extraContext` read it from
// `services.extensions`; the missing case is a bootstrap mistake and gets one consistent message.
export function requireBootstrapExtension<TApi>(
  ctx: { readonly services: { readonly extensions: Readonly<Record<string, unknown>> } },
  callerName: string,
  extension: {
    readonly key: string;
    readonly bootstrapExample: string;
    readonly readme: string;
  },
): TApi {
  // @cast-boundary engine-bridge — the extension arrives per extraContext from the app bootstrap
  // and lands in services.extensions; the framework does not know its type.
  const api = ctx.services.extensions[extension.key] as TApi | undefined;
  if (!api) {
    throw new InternalError({
      message:
        `[${callerName}] ctx.${extension.key} missing — App-Bootstrap muss ` +
        `extraContext: { ${extension.bootstrapExample} } setzen ` +
        `(siehe ${extension.readme}).`,
    });
  }
  return api;
}
