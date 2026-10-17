// Shared dispatch for the magic-link mails (password-reset, email-verification,
// account-unlock, signup-activation, invite). All follow the same delivery
// shape: append the token to the app page and notify the recipient email
// directly (route:{email} skips preferences — the recipient may not have a user
// account yet — and critical priority keeps a security mail non-unsubscribable).
// Each mail type is a trigger-less r.notification whose stored template renders
// from the variables passed here.

import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import type { NotifyFn } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { mailT, resolveMailLocale } from "@cosmicdrift/kumiko-framework/i18n";
import { type AuthMailLocale, tokenMailExpiry } from "./email-templates.js";
import { authMailTemplateLocale } from "./mail-notifications.js";

// Per-flow constants: which notification type to dispatch. fallbackAppName
// replaces the translated default when the flow has no app name of its own.
export type MagicLinkMailSpec = {
  readonly handlerName: string;
  readonly notificationType: string;
  readonly fallbackAppName?: string;
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
  readonly issuedAt?: string;
  readonly timeZone?: string;
  // Invite mails name the role the recipient is invited as.
  readonly role?: string;
};

function resolveAppUrl(appUrl: string | ((locale: string) => string), locale: string): string {
  return typeof appUrl === "function" ? appUrl(locale) : appUrl;
}

function appendToken(appUrl: string, token: string): string {
  const sep = appUrl.includes("?") ? "&" : "?";
  return `${appUrl}${sep}token=${encodeURIComponent(token)}`;
}

// X-Locale on the request wins over the handler's static opts.locale, then
// ctx.locale's resolved default (always set — boot default / "en"). Reading
// requestContext is load-bearing: ctx.locale alone cannot tell whether THIS
// request carried a locale signal.
export function resolveHandlerMailLocale(
  ctx: { readonly locale?: string },
  optsLocale: string | undefined,
): string | undefined {
  return requestContext.get()?.locale ?? optsLocale ?? ctx.locale;
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
  // Template, expiry formatting and app-name fallback must share one locale,
  // otherwise an English template shows e.g. French "3 heures".
  const templateLocale = authMailTemplateLocale(spec.notificationType, locale);
  const { validFor, validUntil } = tokenMailExpiry(
    {
      expiresAt: params.expiresAt,
      ...(params.issuedAt !== undefined && { issuedAt: params.issuedAt }),
      ...(params.timeZone !== undefined && { timeZone: params.timeZone }),
    },
    templateLocale,
  );
  await notify(spec.notificationType, {
    route: { email: params.email },
    data: {
      appName:
        params.appName ?? spec.fallbackAppName ?? mailT(templateLocale, "auth.mail.appNameDefault"),
      actionUrl: appendToken(resolveAppUrl(params.appUrl, urlLocale), params.token),
      validFor,
      validUntil,
      ...(params.role !== undefined && { role: params.role }),
    },
    locale: templateLocale,
    priority: "critical",
  });
}
