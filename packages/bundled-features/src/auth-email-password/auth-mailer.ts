import type { EmailTransport } from "../channel-email";
import type { AuthMailLocale } from "./email-templates";
import {
  renderActivationEmail,
  renderInviteEmail,
  renderResetPasswordEmail,
  renderVerifyEmail,
} from "./email-templates";
import type {
  EmailVerificationOptions,
  InviteOptions,
  PasswordResetOptions,
  SignupOptions,
} from "./feature";

/**
 * Komplette Konfiguration für die 4 Auth-Mail-Flows einer App.
 *
 * Strukturell kompatibel mit den `*Setup`-Typen aus
 * `@cosmicdrift/kumiko-dev-server` (`PasswordResetSetup`,
 * `EmailVerificationSetup`, `SignupSetup`, `InviteSetup`).
 */
export type AuthMailerConfig = {
  readonly passwordReset: PasswordResetOptions & {
    readonly appResetUrl: string;
    readonly sendResetEmail: (args: {
      email: string;
      resetUrl: string;
      expiresAt: string;
    }) => Promise<void>;
  };
  readonly emailVerification: EmailVerificationOptions & {
    readonly appVerifyUrl: string;
    readonly sendVerificationEmail: (args: {
      email: string;
      verificationUrl: string;
      expiresAt: string;
    }) => Promise<void>;
  };
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
  readonly hmacSecret: string;
  /** Basis-URL der App inkl. Schema (z.B. "https://admin.example.com").
   *  Die factory hängt paths.resetPassword etc. an. */
  readonly baseUrl: string;
  /** Pfad-Konstanten für die Auth-Seiten. Default: DEFAULT_AUTH_PATHS. */
  readonly paths?: AuthPaths;
  /** App-Name für Mail-Subject + Body. Default "Account". */
  readonly appName?: string;
  /** Locale für die Mail-Templates. Default "de". */
  readonly locale?: AuthMailLocale;
  /** Email-verification mode. Default undefined (kein Gate).
   *  "strict" blockt Login solange `emailVerified=false`.
   *  "off" mountet die Routes ohne login-gating. */
  readonly emailVerificationMode?: "strict" | "off";
};

/**
 * Factory für `AuthMailerConfig` — baut die 4 Auth-Mail-Setups
 * (passwordReset / emailVerification / signup / invite) inklusive
 * `send*Email`-Wrapper + URL-Konstruktion.
 *
 * Jede App ruft das einmal auf und spreadet das Resultat in die
 * `auth`-Option von `runProdApp` / `runDevApp`.
 */
export function createAuthMailerConfig(args: CreateAuthMailerConfigArgs): AuthMailerConfig {
  const appName = args.appName ?? "Account";
  const locale = args.locale ?? "de";
  const paths = args.paths ?? DEFAULT_AUTH_PATHS;
  return {
    passwordReset: {
      hmacSecret: args.hmacSecret,
      appResetUrl: `${args.baseUrl}${paths.resetPassword}`,
      sendResetEmail: async ({ email, resetUrl, expiresAt }) => {
        await args.mailSender.send({
          to: email,
          ...renderResetPasswordEmail({ resetUrl, expiresAt, locale, appName }),
        });
      },
    },
    emailVerification: {
      hmacSecret: args.hmacSecret,
      ...(args.emailVerificationMode !== undefined && {
        mode: args.emailVerificationMode,
      }),
      appVerifyUrl: `${args.baseUrl}${paths.verifyEmail}`,
      sendVerificationEmail: async ({ email, verificationUrl, expiresAt }) => {
        await args.mailSender.send({
          to: email,
          ...renderVerifyEmail({ verificationUrl, expiresAt, locale, appName }),
        });
      },
    },
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
