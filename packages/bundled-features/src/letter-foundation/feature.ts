import {
  access,
  type ConfigAccessor,
  createTenantConfig,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { featureWithEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import {
  LETTER_CONFIG_KEYS,
  LETTER_ENTITY,
  LETTER_EVENT_SHORT,
  LETTER_FEATURE,
  LETTER_PROVIDER_EXTENSION,
  LETTER_ROLES,
} from "./constants.ts";
import { letterEntity, letterSubmissionTable } from "./entity.ts";
import { letterEnvSchema } from "./env-schema.ts";
import { approveHandler } from "./handlers/approve.write.ts";
import { cancelHandler } from "./handlers/cancel.write.ts";
import { createPreviewQuery } from "./handlers/preview.query.ts";
import { LETTER_FOUNDATION_I18N } from "./i18n.ts";
import { LetterTransitionEventSchema } from "./payloads.ts";
import type { LetterProviderPlugin } from "./types.ts";

declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoExtensionOptionsMap {
    [LETTER_PROVIDER_EXTENSION]: LetterProviderPlugin;
  }
}

const readAccess = { roles: [LETTER_ROLES.approver, ...access.admin] };

export function createLetterFoundationFeature() {
  const feature = defineFeature(
    LETTER_FEATURE,
    (r) => {
      r.describe(
        "Sends PDFs as postal letters through a print provider. Defines the `letterProvider` extension point, the `letter` entity with its status flow (awaiting approval, approved, submitting, accepted, on hold, sent, failed, canceled, returned) and `sendLetter`, which always creates a letter that waits for approval. A user with the LetterApprover role approves it after seeing the price; the letter is then handed to the provider. Live sending needs the LETTER_LIVE env switch and only boots with NODE_ENV=production; without it the inmemory provider runs. A monthly cost limit per tenant is set with the `monthlyCostLimitCents` config key, 0 until a value is set. The recipient address is personal data of the letter.",
      );
      r.uiHints({ displayLabel: "Letters", category: "notifications", recommended: false });
      r.requires({ features: ["config", "files", "cap-counter"] });
      r.envSchema(letterEnvSchema);
      r.extendsRegistrar(LETTER_PROVIDER_EXTENSION, {});

      const monthlyCostLimitCents = r.config({
        keys: {
          [LETTER_CONFIG_KEYS.monthlyCostLimitCents]: createTenantConfig("number", {
            default: 0,
            bounds: { min: 0 },
            write: access.system,
            read: access.admin,
          }),
        },
      }).monthlyCostLimitCents;

      r.translations({ keys: LETTER_FOUNDATION_I18N });
      r.entity(letterEntity);
      r.storeTable(letterSubmissionTable, { reason: "read_side.letter_submissions_direct_write" });

      for (const short of Object.values(LETTER_EVENT_SHORT)) {
        r.defineEvent(short, LetterTransitionEventSchema, { piiFields: "none" });
      }

      r.writeHandler(approveHandler);
      r.writeHandler(cancelHandler);
      r.queryHandler(createPreviewQuery(monthlyCostLimitCents));
      r.queryHandler(
        defineEntityListHandler(LETTER_ENTITY, letterEntity, {
          access: readAccess,
          description:
            "Lists letters with status, shipping mode, price and the object they belong to; paging, filtering and sorting.",
        }),
      );
      r.queryHandler(
        defineEntityDetailHandler(LETTER_ENTITY, letterEntity, {
          access: readAccess,
          description: "Returns one letter with its status, price, tracking and recipient address.",
        }),
      );

      return { monthlyCostLimitCents };
    },
    { dedupeOptions: {} },
  );
  return featureWithEnvSchema(feature, letterEnvSchema);
}

const sharedLetterFoundationFeature = createLetterFoundationFeature();

/** The cascaded monthly limit in cents (tenant row, then system row); 0 when none is set. */
export async function readMonthlyCostLimitCents(config: ConfigAccessor): Promise<number> {
  return (await config(sharedLetterFoundationFeature.exports.monthlyCostLimitCents)) ?? 0;
}
