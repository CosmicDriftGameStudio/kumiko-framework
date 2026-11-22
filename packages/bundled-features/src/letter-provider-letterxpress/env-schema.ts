import * as z from "zod";
import { LETTERXPRESS_ENV } from "./constants.ts";

export const letterXpressEnvSchema = z.object({
  [LETTERXPRESS_ENV.username]: z
    .string()
    .min(1)
    .optional()
    .describe("LetterXpress API user name (customer area, My account > Access data > LXP API)."),
  [LETTERXPRESS_ENV.apiKey]: z
    .string()
    .min(1)
    .optional()
    .describe("LetterXpress API key for the user name above.")
    .meta({ kumiko: { pulumi: { secret: true } } }),
});

export type LetterXpressEnv = z.infer<typeof letterXpressEnvSchema>;
