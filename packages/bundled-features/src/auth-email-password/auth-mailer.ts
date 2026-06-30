import type { EmailTransport } from "../channel-email";
import type { AuthMailLocale } from "./email-templates";
import { renderActivationEmail, renderInviteEmail } from "./email-templates";
import type { InviteOptions, SignupOptions } from "./feature";

/**
 * Mail-callback config for the signup + invite flows.
 *
 * Reset + verify migrated to delivery (ctx.notify) — their callbacks are gone.
 * Strukturell kompatibel mit `SignupSetup` / `InviteSetup` aus
 * `@cosmicdrift/kumiko-dev-server`.
 */
export type AuthMailerConfig = {
  readonly signup: SignupOptions & {
    readonly appActivationUrl: string;
    readonly sendActivationEmail: (args: {
      email: string;
      activationUrl: string;
      expiresAt: string;
    }) => Promise<void>;
  };
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
 * Factory für `AuthMailerConfig` — baut die signup + invite Mail-Setups
 * inklusive `send*Email`-Wrapper + URL-Konstruktion. (Reset + verify laufen
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
    signup: {
      appActivationUrl: `${args.baseUrl}${paths.signupComplete}`,
      sendActivationEmail: async ({ email, activationUrl, expiresAt }) => {
        await args.mailSender.send({
          to: email,
          ...renderActivationEmail({ activationUrl, expiresAt, locale, appName }),
        });
      },
    },
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
