import type { EmailTransport } from "../channel-email";
import type { AuthMailLocale } from "./email-templates";
import { renderInviteEmail } from "./email-templates";
import type { InviteOptions } from "./feature";

/**
 * Mail-callback config for the invite flow.
 *
 * Reset, verify and signup migrated to delivery (ctx.notify) — their callbacks
 * are gone; only invite still delivers via an app callback. Strukturell
 * kompatibel mit `InviteSetup` aus `@cosmicdrift/kumiko-dev-server`.
 */
export type AuthMailerConfig = {
  readonly invite: InviteOptions & {
    readonly appAcceptUrl: string;
    readonly sendInviteEmail: (args: {
      email: string;
      inviteUrl: string;
      expiresAt: string;
      role: string;
    }) => Promise<void>;
  };
};

/** Pfad-Konstanten der 4 Auth-Seiten (relativ zur App-baseUrl). */
export type AuthPaths = {
  readonly resetPassword: string;
  readonly verifyEmail: string;
  readonly signupComplete: string;
  readonly inviteAccept: string;
};

/** Konventions-Pfade — alle Kumiko-Apps nutzen dieselben. Apps überschreiben
 *  nur die Ausnahme via `makeAuthPaths({ ... })`. */
export const DEFAULT_AUTH_PATHS: AuthPaths = {
  resetPassword: "/reset-password",
  verifyEmail: "/verify-email",
  signupComplete: "/signup/complete",
  inviteAccept: "/invite/accept",
};

export function makeAuthPaths(overrides: Partial<AuthPaths> = {}): AuthPaths {
  return { ...DEFAULT_AUTH_PATHS, ...overrides };
}

export type CreateAuthMailerConfigArgs = {
  readonly mailSender: EmailTransport;
  /** Basis-URL der App inkl. Schema (z.B. "https://admin.example.com").
   *  Die factory hängt paths.signupComplete etc. an. */
  readonly baseUrl: string;
  /** Pfad-Konstanten für die Auth-Seiten. Default: DEFAULT_AUTH_PATHS. */
  readonly paths?: AuthPaths;
  /** App-Name für Mail-Subject + Body. Default "Account". */
  readonly appName?: string;
  /** Locale für die Mail-Templates. Default "de". */
  readonly locale?: AuthMailLocale;
};

/**
 * Factory für `AuthMailerConfig` — baut das invite Mail-Setup inklusive
 * `sendInviteEmail`-Wrapper + URL-Konstruktion. (Reset, verify + signup laufen
 * über delivery, nicht mehr über Callbacks.)
 *
 * Jede App ruft das einmal auf und spreadet das Resultat in die
 * `auth`-Option von `runProdApp` / `runDevApp`.
 */
export function createAuthMailerConfig(args: CreateAuthMailerConfigArgs): AuthMailerConfig {
  const appName = args.appName ?? "Account";
  const locale = args.locale ?? "de";
  const paths = args.paths ?? DEFAULT_AUTH_PATHS;
  return {
    invite: {
      appAcceptUrl: `${args.baseUrl}${paths.inviteAccept}`,
      sendInviteEmail: async ({ email, inviteUrl, expiresAt, role }) => {
        await args.mailSender.send({
          to: email,
          ...renderInviteEmail({ inviteUrl, expiresAt, role, locale, appName }),
        });
      },
    },
  };
}
