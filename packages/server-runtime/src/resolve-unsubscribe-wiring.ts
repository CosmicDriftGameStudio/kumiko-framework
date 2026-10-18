import {
  createUnsubscribeRoutes,
  type UnsubscribeLinkConfig,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { type ExtraRouteDefinition, publicOriginOf } from "@cosmicdrift/kumiko-framework/api";
import { APP_BASE_URL_ENV } from "./resolve-auth-public-origin.ts";

export type UnsubscribeOption = {
  readonly secret: string;
  readonly tenantOrigin?: UnsubscribeLinkConfig["tenantOrigin"];
};

export type UnsubscribeWiring = {
  readonly unsubscribeLinks: UnsubscribeLinkConfig | undefined;
  readonly unsubscribeRoutes: readonly ExtraRouteDefinition[];
};

export function resolveUnsubscribeWiring(opts: {
  readonly unsubscribe: UnsubscribeOption | undefined;
  readonly publicOrigin: string | undefined;
  readonly mailBaseUrl: string | undefined;
  readonly envSource: Record<string, string | undefined>;
  readonly warn: (message: string) => void;
}): UnsubscribeWiring {
  const { unsubscribe } = opts;
  if (unsubscribe === undefined) return { unsubscribeLinks: undefined, unsubscribeRoutes: [] };
  const baseUrl = publicOriginOf(
    opts.publicOrigin ?? opts.mailBaseUrl ?? opts.envSource[APP_BASE_URL_ENV] ?? "",
  );
  if (baseUrl === undefined) {
    opts.warn(
      `unsubscribe is enabled but no valid public app URL is known (auth.publicOrigin, auth.mail.baseUrl or ${APP_BASE_URL_ENV}), so mails get no unsubscribe link.`,
    );
  }
  return {
    unsubscribeLinks:
      baseUrl === undefined
        ? undefined
        : {
            secret: unsubscribe.secret,
            baseUrl,
            ...(unsubscribe.tenantOrigin !== undefined && {
              tenantOrigin: unsubscribe.tenantOrigin,
            }),
          },
    unsubscribeRoutes: createUnsubscribeRoutes({ secret: unsubscribe.secret }),
  };
}
