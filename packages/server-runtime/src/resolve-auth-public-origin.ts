import { publicOriginOf } from "@cosmicdrift/kumiko-framework/api";

export const APP_BASE_URL_ENV = "APP_BASE_URL";

type AuthOriginOptions = {
  readonly allowedOrigins?: readonly string[];
  readonly unsafeSkipOriginCheck?: boolean;
  readonly cookieDomain?: string;
  readonly publicOrigin?: string;
  readonly mail?: { readonly baseUrl: string };
};

// The mail link base is what users already open from auth mails, so it wins
// over the infra-provided APP_BASE_URL. Missing or unparsable in production
// is a loud warning, not a boot failure: the double-submit CSRF token still
// protects, the Origin guard is defense in depth.
export function resolveAuthPublicOrigin(
  auth: AuthOriginOptions,
  envSource: Record<string, string | undefined>,
  warn: (message: string) => void,
): string | undefined {
  if ((auth.allowedOrigins?.length ?? 0) > 0 || auth.unsafeSkipOriginCheck === true) {
    return undefined;
  }
  const envBaseUrl = envSource[APP_BASE_URL_ENV] === "" ? undefined : envSource[APP_BASE_URL_ENV];
  const baseUrl = auth.publicOrigin ?? auth.mail?.baseUrl ?? envBaseUrl;
  const origin = baseUrl === undefined ? undefined : publicOriginOf(baseUrl);
  if (
    origin === undefined &&
    auth.cookieDomain === undefined &&
    envSource["NODE_ENV"] === "production"
  ) {
    warn(
      "[runProdApp] WARNING: no valid public app URL is known (auth.publicOrigin, " +
        `auth.mail.baseUrl or ${APP_BASE_URL_ENV}), so the server-side Origin guard is OFF. ` +
        "Cookie-authenticated requests are protected by the CSRF token only. Set " +
        `auth.mail.baseUrl or ${APP_BASE_URL_ENV} to the app's https URL.`,
    );
  }
  return origin;
}
