import * as z from "zod";
import { LETTER_ENV } from "./constants.ts";

const LIVE_RULE_MESSAGE = "the live switch only boots with NODE_ENV=production";

/** A live switch outside production stops the boot, so a wrong environment can never send a letter. */
export function letterLiveEnvRule(
  value: string,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (value !== "true") return undefined;
  return env["NODE_ENV"] === "production" ? undefined : LIVE_RULE_MESSAGE;
}

const liveSwitchSchema = z.enum(["true", "false"]).meta({ kumiko: { envRule: letterLiveEnvRule } });

export const letterEnvSchema = z.object({
  [LETTER_ENV.provider]: z
    .string()
    .min(1)
    .optional()
    .describe("Name of the letter provider used for live sending, for example letterxpress."),
  [LETTER_ENV.live]: liveSwitchSchema
    .optional()
    .describe(
      "true sends real letters through the provider; without it the inmemory provider runs. Boots only with NODE_ENV=production.",
    ),
});

export type LetterEnv = z.infer<typeof letterEnvSchema>;
