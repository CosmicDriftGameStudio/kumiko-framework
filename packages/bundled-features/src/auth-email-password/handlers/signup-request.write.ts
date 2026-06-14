// Magic-Link-Signup, Step 1 (request).
//
// User gibt Email ein → wir minten einen opaken Random-Token, speichern
// ihn bidirektional in Redis (token↔email), und der Route-Layer schickt
// die Activation-Mail. Anders als reset/verify-Flows machen wir HIER keinen
// userId-Lookup und kein HMAC-signing (es gäbe kein Subject — im Normalfall
// existiert der User noch nicht). Ob die Email bereits ein Konto hat,
// entscheidet bewusst der Confirm-Schritt, nicht dieser.
//
// Resend-Idempotenz: wenn für die Email bereits ein lebender Token in
// Redis liegt, geben wir denselben Token zurück (und refreshen TTL auf
// beiden Keys). Der User bekommt dann eine zweite Mail mit dem GLEICHEN
// Activation-Link. Erste Mail bleibt gültig — kein "old link broken"-
// annoyance.
//
// Always-200 (enumeration-safe): das Response sieht für jede Email gleich
// aus, egal ob sie schon registriert ist oder nicht. Eine Email KANN bereits
// ein Konto haben (Seeding oder früherer Signup) — die Sperre dagegen sitzt
// bewusst im Confirm-Schritt (#365): signup-confirm lehnt eine bereits
// registrierte Email ab statt den bestehenden User wiederzuverwenden. Hier
// bleibt's always-200 + Resend-idempotent, damit der Request-Pfad nichts
// leakt; ein request-seitiges Unterdrücken des Links wäre Defense-in-depth,
// aber mit Enumeration-Risiko (separat).

import { generateToken } from "@cosmicdrift/kumiko-framework/api";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { AUTH_SIGNUP_DEFAULT_TTL_MINUTES } from "../constants";
import { getTokenForSignupEmail, normalizeEmail, storeSignupToken } from "../signup-token-store";

const SignupRequestSchema = z.object({
  email: z.email(),
});

export type SignupRequestData =
  | {
      readonly kind: "signup-requested";
      readonly email: string;
      readonly token: string;
      readonly expiresAt: string;
    }
  | { readonly kind: "no-op" };

export type SignupRequestOptions = {
  /** TTL für den Activation-Token. Default 24 h — lang genug damit User
   *  "morgen aktivieren" können ohne Resend-Spam. */
  readonly tokenTtlMinutes?: number;
};

export function createSignupRequestHandler(opts: SignupRequestOptions = {}) {
  const ttlMinutes = opts.tokenTtlMinutes ?? AUTH_SIGNUP_DEFAULT_TTL_MINUTES;
  const ttlSeconds = ttlMinutes * 60;

  return defineWriteHandler<"signup-request", typeof SignupRequestSchema, SignupRequestData>({
    name: "signup-request",
    schema: SignupRequestSchema,
    access: { roles: ["all"] },
    handler: async (event, ctx) => {
      if (!ctx.redis) {
        return writeFailure(
          new InternalError({
            message: "signup-request requires ctx.redis for the activation-token store",
          }),
        );
      }

      // Email-Normalisierung lebt im Store (signup-token-store). Der
      // Handler reicht die raw email durch — eine Quelle, kein Drift
      // zwischen Lookup-Pfaden die unterschiedlich (oder gar nicht)
      // lowercased haben.
      const email = event.payload.email;

      // Resend-Idempotenz: wenn ein Token für diese Email noch lebt,
      // re-use ihn und refreshe beide Keys. Der User kriegt eine zweite
      // Mail mit dem GLEICHEN Link.
      const existingToken = await getTokenForSignupEmail(ctx.redis, email);
      // 32 random bytes = 256 bits unguessable randomness, base64url
      // encoded zu 43 chars. Math.random war früher ein Bug:
      // xorshift128+ hat ~128 Bit State der nach ~5 beobachteten
      // Outputs rekonstruierbar ist — Angreifer könnte eigene
      // signup-requests triggern und die Tokens fremder User
      // vorhersagen. generateToken nutzt randomBytes aus node:crypto,
      // dieselbe Quelle wie CSRF/Session-Tokens.
      const token = existingToken ?? generateToken();

      const expiresAt = Temporal.Now.instant().add({ seconds: ttlSeconds });

      await storeSignupToken(ctx.redis, { email, token, ttlSeconds });

      return {
        isSuccess: true,
        data: {
          kind: "signup-requested",
          // normalizeEmail aus dem Store — eine Quelle für die
          // Normalisierungs-Verantwortung; Mail-Callback kriegt
          // konsistent das gleiche Format wie der Lookup-Pfad.
          email: normalizeEmail(email),
          token,
          expiresAt: expiresAt.toString(),
        },
      };
    },
  });
}
