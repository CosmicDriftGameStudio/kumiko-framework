import type { SecretMintScreenDefinition } from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { validateInlineFormScreen, validateSecretMintConfirm } from "./screens-forms.ts";
import { SCREEN_KIND_RULES } from "./screens-kind-rules.ts";
import type { ScreenValidationContext } from "./screens-kind-shared.ts";

function validateSecretMintRevealFields(
  featureName: string,
  screenId: string,
  screen: SecretMintScreenDefinition,
): void {
  if (screen.reveal.fields.length === 0) {
    throw bootRuleError(SCREEN_KIND_RULES.secretMintRevealFieldsEmpty, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (secretMint) has an empty reveal.fields ` +
        `list — declare at least one field to reveal.`,
    });
  }
  const revealFieldNames = new Set<string>();
  for (const revealField of screen.reveal.fields) {
    if (typeof revealField.field !== "string" || revealField.field.trim() === "") {
      throw bootRuleError(SCREEN_KIND_RULES.secretMintRevealFieldNameEmpty, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (secretMint) has a reveal.fields entry ` +
          `with an empty or non-string "field". Set field to a non-empty string.`,
      });
    }
    if (revealFieldNames.has(revealField.field)) {
      throw bootRuleError(SCREEN_KIND_RULES.secretMintRevealFieldDuplicate, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (secretMint) reveal.fields has a ` +
          `duplicate field "${revealField.field}" — each revealed field must be unique.`,
      });
    }
    revealFieldNames.add(revealField.field);
    if (typeof revealField.label !== "string" || revealField.label.trim() === "") {
      throw bootRuleError(SCREEN_KIND_RULES.secretMintRevealFieldLabelEmpty, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (secretMint) reveal.fields entry ` +
          `"${revealField.field}" has an empty or non-string "label". Set label to a non-empty string.`,
      });
    }
  }
}

export function validateSecretMintScreen(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: SecretMintScreenDefinition,
): void {
  validateInlineFormScreen(
    ctx.feature,
    screenId,
    screen,
    "secretMint",
    ctx.allWriteHandlerQns,
    ctx,
    ctx.featureMap,
  );
  validateSecretMintRevealFields(ctx.feature.name, screenId, screen);
  validateSecretMintConfirm(ctx.feature, screenId, screen, ctx.allWriteHandlerQns);
}
