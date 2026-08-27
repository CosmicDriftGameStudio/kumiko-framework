// Shared dispatch for the magic-link mails (password-reset, email-verification,
// signup-activation). All three follow the same delivery shape: append the
// token to the app page, render structured content, and notify the recipient
// email directly (route:{email} skips preferences — the recipient may not have
// a user account yet — and critical priority keeps a security mail
// non-unsubscribable). No r.notification is declared; buildMessage falls back
// to the structured `data` for the renderer.

import type { NotifyFn } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { resolveMailLocale } from "@cosmicdrift/kumiko-framework/i18n";
import type { AuthMailContent, AuthMailLocale, RenderTokenContentArgs } from "./email-templates";

// Per-flow constants: which notification type to dispatch and how to render the
// body. renderContent is the flow's template (renderResetPasswordEmail / … /
// renderActivationEmail), all unified on RenderTokenContentArgs → AuthMailContent.
export type MagicLinkMailSpec = {
  readonly handlerName: string;
  readonly notificationType: string;
  readonly renderContent: (args: RenderTokenContentArgs) => AuthMailContent;
};

// Per-request values: the recipient + the app page that receives the token, plus
// optional presentation. appUrl is the bare page URL; the token is appended here.
// appUrl as a function lets apps with language-in-path routing (/de/activate,
// /en/activate) pick the right page for `locale` — the mail is the only
// channel that survives a device switch (signup on desktop, open on mobile),
// so this is the last point where the language can still reach the link.
export type MagicLinkMailParams = {
  readonly email: string;
  readonly appUrl: string | ((locale: string) => string);
  readonly token: string;
  readonly expiresAt: string;
  readonly appName?: string;
  readonly locale?: AuthMailLocale;
};

function resolveAppUrl(appUrl: string | ((locale: string) => string), locale: string): string {
  return typeof appUrl === "function" ? appUrl(locale) : appUrl;
}

function appendToken(appUrl: string, token: string): string {
  const sep = appUrl.includes("?") ? "&" : "?";
  return `${appUrl}${sep}token=${encodeURIComponent(token)}`;
}

export async function dispatchMagicLinkMail(
  notify: NotifyFn | undefined,
  spec: MagicLinkMailSpec,
  params: MagicLinkMailParams,
): Promise<void> {
  // delivery is a hard requirement when a magic-link flow is mounted (see
  // feature.ts r.requires), so notify is always wired — this guard is a
  // defensive boot-invariant, not a runtime branch.
  if (!notify) {
    throw new InternalError({
      message: `${spec.handlerName}: ctx.notify unavailable — the delivery feature must be mounted`,
    });
  }
  const locale = params.locale ?? "en";
  // mailT already root-falls-back; appUrl must use the same negotiated tag
  // or language-in-path apps 404 on e.g. /de-AT/activate.
  const urlLocale = resolveMailLocale(locale);
  const content = spec.renderContent({
    url: appendToken(resolveAppUrl(params.appUrl, urlLocale), params.token),
    expiresAt: params.expiresAt,
    ...(params.locale !== undefined && { locale: params.locale }),
    ...(params.appName !== undefined && { appName: params.appName }),
  });
  await notify(spec.notificationType, {
    route: { email: params.email },
    data: content,
    priority: "critical",
  });
}
