import {
  parseTrustedProxyHopsEnv,
  TRUSTED_PROXY_HOPS_ENV,
} from "@cosmicdrift/kumiko-framework/api";

export function resolveTrustedProxyHops(input: {
  readonly option: number | undefined;
  readonly authOption: number | undefined;
  readonly envValue: string | undefined;
  readonly nodeEnv: string | undefined;
}): number | undefined {
  const hops =
    input.option ?? input.authOption ?? parseTrustedProxyHopsEnv(input.envValue, "runProdApp");
  if (hops === undefined && input.nodeEnv === "production") {
    throw new Error(
      `[runProdApp] trustedProxyHops is required in production: pass the trustedProxyHops option or set ${TRUSTED_PROXY_HOPS_ENV} ` +
        "(0 when the app is exposed directly). Without it every client behind a reverse proxy shares one rate-limit bucket.",
    );
  }
  return hops;
}
