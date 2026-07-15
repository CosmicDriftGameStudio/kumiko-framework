// Hand-rolled stand-in for the real `ai-text` feature (kumiko-enterprise/
// packages/ai-text). kumiko-framework is public NPM and must never import
// the private enterprise package, so this demo duplicates the
// `ai-text:query:run` wire contract by hand — canned string transforms
// instead of a real LLM call — purely so AiTextField/AiTextArea can be
// driven end-to-end in the styleguide. Feature name MUST stay "ai-text":
// that's what produces the `ai-text:query:run` QN the widget's hooks call.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const runInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("complete"), text: z.string() }),
  z.object({ mode: z.literal("correct"), text: z.string().min(1) }),
  z.object({
    mode: z.literal("translate"),
    text: z.string().min(1),
    targetLanguage: z.string().min(1),
  }),
  z.object({
    mode: z.literal("rewrite"),
    text: z.string().min(1),
    style: z.enum(["formal", "casual", "concise", "expand"]).optional(),
  }),
]);

type RunInput = z.infer<typeof runInput>;

const CORRECTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bteh\b/gi, "the"],
  [/\bdont\b/gi, "don't"],
  [/\brecieve\b/gi, "receive"],
];

function cannedText(payload: RunInput): string {
  switch (payload.mode) {
    case "complete":
      return payload.text.endsWith(" ") ? "and it just works." : " and it just works.";
    case "correct":
      return CORRECTIONS.reduce((text, [pattern, fix]) => text.replace(pattern, fix), payload.text);
    case "translate":
      return `[${payload.targetLanguage}] ${payload.text}`;
    case "rewrite":
      return `[${payload.style ?? "concise"}] ${payload.text}`;
  }
}

export const aiTextDemoFeature = defineFeature("ai-text", (r) => {
  r.queryHandler(
    "run",
    runInput,
    async ({ payload }) => {
      const text = cannedText(payload);
      return {
        type: "text" as const,
        text,
        usage: { inputTokens: payload.text.length, outputTokens: text.length },
      };
    },
    { access: { openToAll: true } },
  );
});
